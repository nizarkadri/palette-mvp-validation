import { renderSemaphore } from "./concurrency.js";
import { systemClock, validateClock } from "./deadlines.js";
import { ProcessorDeadlineExceededError } from "./errors.js";
import {
	assertProcessorActive,
	capProcessorTimeoutMs,
	processorRemainingTimeMs,
} from "./processorContext.js";

function attachSecondaryError(error, label, secondaryError) {
	if (!error || (typeof error !== "object" && typeof error !== "function")) {
		return;
	}
	try {
		if (!Array.isArray(error.secondaryErrors)) {
			Object.defineProperty(error, "secondaryErrors", {
				value: [],
				enumerable: false,
			});
		}
		error.secondaryErrors.push({ label, error: secondaryError });
	} catch {
		// Preserve a primary error even when a foreign error is non-extensible.
	}
}

export class RenderCleanupTimeoutError extends Error {
	constructor(label) {
		super("Render cleanup did not finish within its bounded timeout.");
		this.name = "RenderCleanupTimeoutError";
		this.code = "RENDER_CLEANUP_TIMEOUT";
		this.cleanupLabel = label;
	}
}

async function runBoundedCleanup(task, timeoutMs, clock) {
	let timer = null;
	const cleanupPromise = Promise.resolve().then(task.cleanup);
	const timeoutPromise = new Promise((_, reject) => {
		timer = clock.setTimeout(
			() => reject(new RenderCleanupTimeoutError(task.label)),
			timeoutMs,
		);
	});
	try {
		await Promise.race([cleanupPromise, timeoutPromise]);
	} finally {
		if (timer !== null) clock.clearTimeout(timer);
	}
}

/**
 * Coordinates one context-aware Chromium operation through the process-wide
 * render semaphore. Expensive work must be performed through awaitExpensive so
 * cancellation/deadline state is checked on both sides of every await.
 */
export async function executeRenderOperation({
	context,
	semaphore = renderSemaphore,
	stage = "render",
	operation,
	cleanupTimeoutMs = 5_000,
	cleanupClock = systemClock,
} = {}) {
	if (typeof operation !== "function") {
		throw new TypeError("Render operation must be a function.");
	}
	if (!Number.isFinite(cleanupTimeoutMs) || cleanupTimeoutMs <= 0) {
		throw new TypeError("Render cleanup timeout must be a positive number.");
	}
	validateClock(cleanupClock);

	assertProcessorActive(context, stage);
	const releasePermit = await semaphore.acquire({
		signal: context.signal,
		deadlineAt: context.effectiveDeadlineAt,
		stage,
		clock: context.clock,
	});
	const cleanupTasks = [];
	let cleanupState = "collecting";
	let primaryError = null;
	let operationFailed = false;

	function reportLateCleanupFailure(task, cleanupError) {
		if (primaryError) {
			attachSecondaryError(primaryError, task.label, cleanupError);
		}
		try {
			context.logger.error(task.label, { cause: cleanupError });
		} catch (loggerError) {
			if (primaryError) {
				attachSecondaryError(
					primaryError,
					"Secondary failure logging failed.",
					loggerError,
				);
			}
		}
	}

	function runLateCleanup(task) {
		// A resource may resolve after cancellation already released the render
		// permit. Its cleanup is bounded and fully observed, but cannot replace the
		// primary control-flow result.
		void runBoundedCleanup(task, cleanupTimeoutMs, cleanupClock).catch(
			(cleanupError) => reportLateCleanupFailure(task, cleanupError),
		);
	}

	function deferCleanup(label, cleanup) {
		if (typeof cleanup !== "function") {
			throw new TypeError("Render cleanup must be a function.");
		}
		const task = {
			label:
				typeof label === "string" && label.trim()
					? label.trim()
					: "Render cleanup failed.",
			cleanup,
		};
		if (cleanupState === "collecting") {
			cleanupTasks.push(task);
		} else {
			runLateCleanup(task);
		}
	}

	function contextControlRace(awaitStage) {
		let timer = null;
		let settled = false;
		let resolveControl;
		const promise = new Promise((resolve) => {
			resolveControl = resolve;
		});

		function settle(error) {
			if (settled) return;
			settled = true;
			resolveControl({ type: "control", error });
		}

		function onAbort() {
			try {
				assertProcessorActive(context, awaitStage);
			} catch (error) {
				settle(error);
			}
		}

		const remainingMs = processorRemainingTimeMs(context);
		context.signal.addEventListener("abort", onAbort, { once: true });
		if (context.signal.aborted) {
			onAbort();
		} else if (remainingMs <= 0) {
			settle(new ProcessorDeadlineExceededError({ stage: awaitStage }));
		} else {
			timer = context.clock.setTimeout(
				() =>
					settle(new ProcessorDeadlineExceededError({ stage: awaitStage })),
				Math.max(1, Math.ceil(remainingMs)),
			);
		}

		return {
			promise,
			dispose() {
				settled = true;
				context.signal.removeEventListener("abort", onAbort);
				if (timer !== null) context.clock.clearTimeout(timer);
				timer = null;
			},
		};
	}

	async function awaitExpensive(
		awaitStage,
		expensiveOperation,
		{ onResolved } = {},
	) {
		if (typeof expensiveOperation !== "function") {
			throw new TypeError("Expensive render operation must be a function.");
		}
		if (onResolved !== undefined && typeof onResolved !== "function") {
			throw new TypeError("onResolved must be a function when provided.");
		}
		assertProcessorActive(context, awaitStage);

		let expensivePromise;
		try {
			expensivePromise = Promise.resolve(expensiveOperation());
		} catch (error) {
			assertProcessorActive(context, awaitStage);
			throw error;
		}
		// Mapping both branches makes a late rejection observed even after the
		// context-control branch wins the race.
		const expensiveOutcome = expensivePromise.then(
			(value) => ({ type: "resolved", value }),
			(error) => ({ type: "rejected", error }),
		);
		const control = contextControlRace(awaitStage);
		let outcome;
		try {
			outcome = await Promise.race([expensiveOutcome, control.promise]);
		} finally {
			control.dispose();
		}

		if (outcome.type === "control") {
			if (onResolved) {
				void expensiveOutcome
					.then((lateOutcome) => {
						if (lateOutcome.type === "resolved") {
							onResolved(lateOutcome.value);
						}
					})
					.catch((lateError) => {
						reportLateCleanupFailure(
							{ label: "Late render resource cleanup failed." },
							lateError,
						);
					});
			}
			throw outcome.error;
		}
		if (outcome.type === "rejected") {
			// Context control flow takes precedence over a browser rejection that
			// settles concurrently with cancellation/deadline expiry.
			assertProcessorActive(context, awaitStage);
			throw outcome.error;
		}

		try {
			// Register acquired-resource cleanup before the post-await active check.
			onResolved?.(outcome.value);
		} catch (error) {
			assertProcessorActive(context, awaitStage);
			throw error;
		}
		assertProcessorActive(context, awaitStage);
		return outcome.value;
	}

	try {
		assertProcessorActive(context, stage);
		return await operation({
			assertActive: (activeStage = stage) =>
				assertProcessorActive(context, activeStage),
			awaitExpensive,
			capWaitTimeoutMs: (configuredTimeoutMs, waitStage = stage) =>
				capProcessorTimeoutMs(context, configuredTimeoutMs, waitStage),
			remainingTimeMs: () => processorRemainingTimeMs(context),
			deferCleanup,
		});
	} catch (error) {
		primaryError = error;
		operationFailed = true;
		throw error;
	} finally {
		cleanupState = "running";
		for (const task of cleanupTasks.reverse()) {
			try {
				await runBoundedCleanup(task, cleanupTimeoutMs, cleanupClock);
			} catch (cleanupError) {
				if (!primaryError) {
					primaryError = cleanupError;
				} else {
					attachSecondaryError(primaryError, task.label, cleanupError);
					try {
						context.logger.error(task.label, { cause: cleanupError });
					} catch (loggerError) {
						attachSecondaryError(
							primaryError,
							"Secondary failure logging failed.",
							loggerError,
						);
					}
				}
			}
		}
		try {
			releasePermit();
		} catch (releaseError) {
			if (!primaryError) {
				primaryError = releaseError;
			} else {
				attachSecondaryError(
					primaryError,
					"Render semaphore release failed.",
					releaseError,
				);
			}
		}
		cleanupState = "finished";
		if (!operationFailed && primaryError) throw primaryError;
	}
}

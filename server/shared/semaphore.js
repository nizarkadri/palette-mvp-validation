import { remainingTimeMs, systemClock, validateClock } from "./deadlines.js";
import { ProcessorDeadlineExceededError, throwIfAborted } from "./errors.js";

function requireLimit(limit) {
	if (!Number.isInteger(limit) || limit <= 0) {
		throw new TypeError("Semaphore limit must be a positive integer.");
	}
	return limit;
}

export function createSemaphore(
	limit,
	{ clock = systemClock, name = "semaphore" } = {},
) {
	requireLimit(limit);
	validateClock(clock);
	let activeCount = 0;
	const queue = [];

	function createRelease() {
		let released = false;
		return function release() {
			if (released) return;
			released = true;
			activeCount -= 1;
			drain();
		};
	}

	function removeWaiter(waiter) {
		const index = queue.indexOf(waiter);
		if (index >= 0) queue.splice(index, 1);
	}

	function cleanupWaiter(waiter) {
		waiter.signal.removeEventListener("abort", waiter.onAbort);
		if (waiter.timer !== null) waiter.clock.clearTimeout(waiter.timer);
		waiter.timer = null;
	}

	function rejectWaiter(waiter, error) {
		if (waiter.settled) return;
		waiter.settled = true;
		removeWaiter(waiter);
		cleanupWaiter(waiter);
		waiter.reject(error);
	}

	function grantWaiter(waiter) {
		if (waiter.settled) return;
		waiter.settled = true;
		removeWaiter(waiter);
		cleanupWaiter(waiter);
		activeCount += 1;
		waiter.resolve(createRelease());
	}

	function drain() {
		while (activeCount < limit && queue.length > 0) {
			const waiter = queue[0];
			if (waiter.signal.aborted) {
				try {
					throwIfAborted(waiter.signal, waiter.stage);
				} catch (error) {
					rejectWaiter(waiter, error);
				}
				continue;
			}
			if (remainingTimeMs(waiter.deadlineAt, waiter.clock) <= 0) {
				rejectWaiter(
					waiter,
					new ProcessorDeadlineExceededError({ stage: waiter.stage }),
				);
				continue;
			}
			grantWaiter(waiter);
		}
	}

	async function acquire({
		signal,
		deadlineAt,
		stage = name,
		clock: acquisitionClock = clock,
	} = {}) {
		validateClock(acquisitionClock);
		throwIfAborted(signal, stage);
		const remaining = remainingTimeMs(deadlineAt, acquisitionClock);
		if (remaining <= 0) {
			throw new ProcessorDeadlineExceededError({ stage });
		}

		if (activeCount < limit) {
			activeCount += 1;
			return createRelease();
		}

		return new Promise((resolve, reject) => {
			const waiter = {
				signal,
				deadlineAt,
				stage,
				clock: acquisitionClock,
				resolve,
				reject,
				settled: false,
				timer: null,
				onAbort: null,
			};
			waiter.onAbort = () => {
				try {
					throwIfAborted(signal, stage);
				} catch (error) {
					rejectWaiter(waiter, error);
				}
			};

			queue.push(waiter);
			signal.addEventListener("abort", waiter.onAbort, { once: true });
			waiter.timer = acquisitionClock.setTimeout(
				() => {
					rejectWaiter(waiter, new ProcessorDeadlineExceededError({ stage }));
				},
				Math.max(1, Math.ceil(remaining)),
			);
			if (signal.aborted) waiter.onAbort();
		});
	}

	async function run(options, operation) {
		if (typeof operation !== "function") {
			throw new TypeError("Semaphore operation must be a function.");
		}
		const release = await acquire(options);
		try {
			const stage = options?.stage || name;
			throwIfAborted(options?.signal, stage);
			if (
				remainingTimeMs(options?.deadlineAt, options?.clock || clock) <= 0
			) {
				throw new ProcessorDeadlineExceededError({ stage });
			}
			return await operation();
		} finally {
			release();
		}
	}

	return Object.freeze({
		name,
		limit,
		acquire,
		run,
		get activeCount() {
			return activeCount;
		},
		get pendingCount() {
			return queue.length;
		},
	});
}

import { remainingTimeMs } from "../shared/deadlines.js";
import {
	ProcessorDeadlineExceededError,
	throwIfAborted,
} from "../shared/errors.js";

export const PROCESSOR_EVENT_VERSION = 1;

export const PROCESSOR_EVENT_TYPES = Object.freeze({
	GENERATION: "generation",
	EVALUATION: "evaluation",
	FAILURE: "failure",
	COMPLETION: "completion",
});

const FAILURE_STAGES = new Set(["generation", "evaluation"]);
const MAX_VARIANTS = 100;
const EVENT_BASE_FIELDS = ["version", "type", "sequence"];
const EVENT_FIELDS = Object.freeze({
	[PROCESSOR_EVENT_TYPES.GENERATION]: new Set([
		...EVENT_BASE_FIELDS,
		"variantIndex",
		"variantSequence",
		"output",
	]),
	[PROCESSOR_EVENT_TYPES.EVALUATION]: new Set([
		...EVENT_BASE_FIELDS,
		"variantIndex",
		"variantSequence",
		"evaluation",
	]),
	[PROCESSOR_EVENT_TYPES.FAILURE]: new Set([
		...EVENT_BASE_FIELDS,
		"variantIndex",
		"variantSequence",
		"stage",
		"code",
		"retryable",
		"safeMessage",
	]),
	[PROCESSOR_EVENT_TYPES.COMPLETION]: new Set([
		...EVENT_BASE_FIELDS,
		"variantCount",
		"recommendedVariantIndex",
		"result",
	]),
});

const FAILURE_MESSAGES = Object.freeze({
	generation: "Variant generation failed.",
	evaluation: "Variant evaluation failed.",
});

const PROGRESS_DESCRIPTORS = Object.freeze({
	[PROCESSOR_EVENT_TYPES.GENERATION]: Object.freeze({
		stage: "generation",
		safeMessage: "Variant generation completed.",
	}),
	[PROCESSOR_EVENT_TYPES.EVALUATION]: Object.freeze({
		stage: "evaluation",
		safeMessage: "Variant evaluation completed.",
	}),
	[PROCESSOR_EVENT_TYPES.FAILURE]: Object.freeze({
		stage: "processing",
		safeMessage: "Variant processing finished safely.",
	}),
	[PROCESSOR_EVENT_TYPES.COMPLETION]: Object.freeze({
		stage: "complete",
		safeMessage: "Processing completed.",
	}),
});

function requirePlainObject(value, name) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		(Object.getPrototypeOf(value) !== Object.prototype &&
			Object.getPrototypeOf(value) !== null)
	) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	if (Object.getOwnPropertySymbols(value).length > 0) {
		throw new TypeError(`${name} must not contain symbol fields.`);
	}
	for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
		if (!descriptor.enumerable || !("value" in descriptor)) {
			throw new TypeError(`${name} must contain only enumerable data fields.`);
		}
	}
	return value;
}

function requireExactFields(value, allowed, name) {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			throw new TypeError(`${name}.${key} is not allowed.`);
		}
	}
}

function requireSafeInteger(value, name, { min = 0, max } = {}) {
	if (
		!Number.isSafeInteger(value) ||
		value < min ||
		(max !== undefined && value > max)
	) {
		throw new TypeError(`${name} must be a safe integer in range.`);
	}
	return value;
}

function requireVariantCount(value) {
	return requireSafeInteger(value, "variantCount", {
		min: 1,
		max: MAX_VARIANTS,
	});
}

function requireVariantIndex(value, variantCount, name = "variantIndex") {
	return requireSafeInteger(value, name, {
		min: 0,
		max: variantCount - 1,
	});
}

function requireSequence(value, name) {
	return requireSafeInteger(value, name, { min: 1 });
}

function sanitizeCode(value) {
	if (typeof value !== "string") {
		throw new TypeError("failure code must be a string.");
	}
	const code = value.trim().toUpperCase();
	if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(code)) {
		throw new TypeError("failure code must be a safe symbolic code.");
	}
	return code;
}

function sanitizeJsonValue(value, name, ancestors = new Set()) {
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "string") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError(`${name} must contain only finite numbers.`);
		}
		return value;
	}
	if (typeof value !== "object") {
		throw new TypeError(`${name} must contain only JSON-like values.`);
	}
	if (ancestors.has(value)) {
		throw new TypeError(`${name} must not contain cycles.`);
	}

	ancestors.add(value);
	if (Array.isArray(value)) {
		const descriptors = Object.getOwnPropertyDescriptors(value);
		if (
			Object.getOwnPropertySymbols(value).length > 0 ||
			Object.keys(value).length !== value.length ||
			Object.entries(descriptors).some(([key, descriptor]) =>
				key === "length"
					? false
					: !descriptor.enumerable || !("value" in descriptor),
			)
		) {
			throw new TypeError(`${name} must be a dense data-only array.`);
		}
		const copy = value.map((item, index) =>
			sanitizeJsonValue(item, `${name}[${index}]`, ancestors),
		);
		ancestors.delete(value);
		return Object.freeze(copy);
	}

	requirePlainObject(value, name);
	const copy = Object.create(null);
	for (const [key, nested] of Object.entries(value)) {
		if (key === "__proto__" || key === "prototype" || key === "constructor") {
			throw new TypeError(`${name} contains a prohibited key.`);
		}
		copy[key] = sanitizeJsonValue(nested, `${name}.${key}`, ancestors);
	}
	ancestors.delete(value);
	return Object.freeze(copy);
}

function validateEventBase(event) {
	requirePlainObject(event, "event");
	if (event.version !== PROCESSOR_EVENT_VERSION) {
		throw new TypeError(
			`event.version must be ${PROCESSOR_EVENT_VERSION}.`,
		);
	}
	if (!Object.values(PROCESSOR_EVENT_TYPES).includes(event.type)) {
		throw new TypeError("event.type is not supported.");
	}
	requireExactFields(event, EVENT_FIELDS[event.type], "event");
	return {
		version: PROCESSOR_EVENT_VERSION,
		type: event.type,
		sequence: requireSequence(event.sequence, "event.sequence"),
	};
}

/**
 * Validates an event received across the processor-event port and returns a
 * deeply frozen, prototype-free copy. No transport-specific fields are
 * accepted. Callers should use the event stream below to assign order.
 */
export function validateProcessorEvent(event, { variantCount = 3 } = {}) {
	const count = requireVariantCount(variantCount);
	const base = validateEventBase(event);
	let sanitized;

	switch (event.type) {
		case PROCESSOR_EVENT_TYPES.GENERATION:
			sanitized = {
				...base,
				variantIndex: requireVariantIndex(event.variantIndex, count),
				variantSequence: requireSequence(
					event.variantSequence,
					"event.variantSequence",
				),
				output: sanitizeJsonValue(event.output, "event.output"),
			};
			break;
		case PROCESSOR_EVENT_TYPES.EVALUATION:
			sanitized = {
				...base,
				variantIndex: requireVariantIndex(event.variantIndex, count),
				variantSequence: requireSequence(
					event.variantSequence,
					"event.variantSequence",
				),
				evaluation: sanitizeJsonValue(
					event.evaluation,
					"event.evaluation",
				),
			};
			break;
		case PROCESSOR_EVENT_TYPES.FAILURE: {
			if (!FAILURE_STAGES.has(event.stage)) {
				throw new TypeError("event.stage is not a supported failure stage.");
			}
			if (event.safeMessage !== FAILURE_MESSAGES[event.stage]) {
				throw new TypeError("event.safeMessage is not the canonical safe message.");
			}
			if (typeof event.retryable !== "boolean") {
				throw new TypeError("event.retryable must be a boolean.");
			}
			sanitized = {
				...base,
				variantIndex: requireVariantIndex(event.variantIndex, count),
				variantSequence: requireSequence(
					event.variantSequence,
					"event.variantSequence",
				),
				stage: event.stage,
				code: sanitizeCode(event.code),
				retryable: event.retryable,
				safeMessage: FAILURE_MESSAGES[event.stage],
			};
			break;
		}
		case PROCESSOR_EVENT_TYPES.COMPLETION:
			if (event.variantCount !== count) {
				throw new TypeError(
					"event.variantCount does not match the configured variant count.",
				);
			}
			sanitized = {
				...base,
				variantCount: count,
				recommendedVariantIndex: requireVariantIndex(
					event.recommendedVariantIndex,
					count,
					"recommendedVariantIndex",
				),
				result: sanitizeJsonValue(event.result, "event.result"),
			};
			break;
	}

	return Object.freeze(sanitized);
}

function createOrderTracker(variantCount) {
	const states = Array.from({ length: variantCount }, () => "pending");
	const variantSequences = Array.from({ length: variantCount }, () => 0);
	let sequence = 0;
	let completed = false;

	return {
		nextVariant(type, variantIndex, failureStage) {
			if (completed) throw new Error("Cannot emit an event after completion.");
			const state = states[variantIndex];
			if (type === PROCESSOR_EVENT_TYPES.GENERATION && state !== "pending") {
				throw new Error("Generation must be the first event for a variant.");
			}
			if (type === PROCESSOR_EVENT_TYPES.EVALUATION && state !== "generated") {
				throw new Error("Evaluation must follow generation for a variant.");
			}
			if (type === PROCESSOR_EVENT_TYPES.FAILURE) {
				const expected = failureStage === "generation" ? "pending" : "generated";
				if (state !== expected) {
					throw new Error(
						`${failureStage} failure is not causal for the variant state.`,
					);
				}
			}

			states[variantIndex] =
				type === PROCESSOR_EVENT_TYPES.GENERATION
					? "generated"
					: type === PROCESSOR_EVENT_TYPES.EVALUATION
						? "evaluated"
						: "failed";
			sequence += 1;
			variantSequences[variantIndex] += 1;
			return { sequence, variantSequence: variantSequences[variantIndex] };
		},
		nextCompletion() {
			if (completed) throw new Error("Completion may only be emitted once.");
			if (states.some((state) => state !== "evaluated")) {
				throw new Error(
					"Completion requires every variant to be generated and evaluated.",
				);
			}
			completed = true;
			sequence += 1;
			return sequence;
		},
	};
}

/**
 * Creates the only supported producer for ordered processor events. Sequence
 * numbers are assigned synchronously, so concurrent variants can interleave
 * while each variant's generation -> evaluation/failure order remains causal.
 * This producer never reports global progress.
 */
export function createProcessorEventStream({
	emitProcessorEvent,
	variantCount = 3,
} = {}) {
	if (typeof emitProcessorEvent !== "function") {
		throw new TypeError("emitProcessorEvent must be a function.");
	}
	const count = requireVariantCount(variantCount);
	const order = createOrderTracker(count);
	let deliveryTail = Promise.resolve();

	function emit(event) {
		const validated = validateProcessorEvent(event, { variantCount: count });
		const delivery = deliveryTail.then(() => emitProcessorEvent(validated));
		// Keep the causal queue rejected after a failed transport so later events,
		// especially completion, cannot overtake failed persistence. The attached
		// handler prevents an ignored internal tail from becoming unhandled.
		deliveryTail = delivery;
		delivery.catch(() => {});
		return delivery.then(() => validated);
	}

	return Object.freeze({
		generation({ variantIndex, output } = {}) {
			const index = requireVariantIndex(variantIndex, count);
			const safeOutput = sanitizeJsonValue(output, "output");
			const position = order.nextVariant(
				PROCESSOR_EVENT_TYPES.GENERATION,
				index,
			);
			return emit({
				version: PROCESSOR_EVENT_VERSION,
				type: PROCESSOR_EVENT_TYPES.GENERATION,
				...position,
				variantIndex: index,
				output: safeOutput,
			});
		},
		evaluation({ variantIndex, evaluation } = {}) {
			const index = requireVariantIndex(variantIndex, count);
			const safeEvaluation = sanitizeJsonValue(evaluation, "evaluation");
			const position = order.nextVariant(
				PROCESSOR_EVENT_TYPES.EVALUATION,
				index,
			);
			return emit({
				version: PROCESSOR_EVENT_VERSION,
				type: PROCESSOR_EVENT_TYPES.EVALUATION,
				...position,
				variantIndex: index,
				evaluation: safeEvaluation,
			});
		},
		failure({ variantIndex, stage, code, retryable } = {}) {
			const index = requireVariantIndex(variantIndex, count);
			if (!FAILURE_STAGES.has(stage)) {
				throw new TypeError("stage is not a supported failure stage.");
			}
			const safeCode = sanitizeCode(code);
			if (typeof retryable !== "boolean") {
				throw new TypeError("retryable must be a boolean.");
			}
			const position = order.nextVariant(
				PROCESSOR_EVENT_TYPES.FAILURE,
				index,
				stage,
			);
			return emit({
				version: PROCESSOR_EVENT_VERSION,
				type: PROCESSOR_EVENT_TYPES.FAILURE,
				...position,
				variantIndex: index,
				stage,
				code: safeCode,
				retryable,
				safeMessage: FAILURE_MESSAGES[stage],
			});
		},
		completion({ recommendedVariantIndex, result } = {}) {
			const index = requireVariantIndex(
				recommendedVariantIndex,
				count,
				"recommendedVariantIndex",
			);
			const safeResult = sanitizeJsonValue(result, "result");
			return emit({
				version: PROCESSOR_EVENT_VERSION,
				type: PROCESSOR_EVENT_TYPES.COMPLETION,
				sequence: order.nextCompletion(),
				variantCount: count,
				recommendedVariantIndex: index,
				result: safeResult,
			});
		},
	});
}

/**
 * Consumes validated processor events and is the sole caller of the supplied
 * reportProgress port. Percent is derived from aggregate variant state, never
 * accepted from an individual event.
 */
export function createProcessorProgressAggregator({
	reportProgress,
	variantCount = 3,
} = {}) {
	if (typeof reportProgress !== "function") {
		throw new TypeError("reportProgress must be a function.");
	}
	const count = requireVariantCount(variantCount);
	const states = Array.from({ length: count }, () => "pending");
	let lastSequence = 0;
	let lastPercent = 0;
	let completed = false;
	let reportTail = Promise.resolve();

	function completedUnits() {
		return states.reduce((total, state) => {
			if (state === "generated") return total + 1;
			if (state === "evaluated" || state === "failed") return total + 2;
			return total;
		}, 0);
	}

	return Object.freeze({
		consume(input) {
			const event = validateProcessorEvent(input, { variantCount: count });
			if (completed) throw new Error("Progress cannot consume after completion.");
			if (event.sequence !== lastSequence + 1) {
				throw new Error("Processor event sequence is not contiguous.");
			}

			if (event.type === PROCESSOR_EVENT_TYPES.GENERATION) {
				if (
					states[event.variantIndex] !== "pending" ||
					event.variantSequence !== 1
				) {
					throw new Error("Generation progress event is not causal.");
				}
				states[event.variantIndex] = "generated";
			} else if (event.type === PROCESSOR_EVENT_TYPES.EVALUATION) {
				if (
					states[event.variantIndex] !== "generated" ||
					event.variantSequence !== 2
				) {
					throw new Error("Evaluation progress event is not causal.");
				}
				states[event.variantIndex] = "evaluated";
			} else if (event.type === PROCESSOR_EVENT_TYPES.FAILURE) {
				const expectedState =
					event.stage === "generation" ? "pending" : "generated";
				const expectedSequence = event.stage === "generation" ? 1 : 2;
				if (
					states[event.variantIndex] !== expectedState ||
					event.variantSequence !== expectedSequence
				) {
					throw new Error("Failure progress event is not causal.");
				}
				states[event.variantIndex] = "failed";
			} else {
				if (states.some((state) => state !== "evaluated")) {
					throw new Error("Completion progress requires all variants evaluated.");
				}
				completed = true;
			}

			lastSequence = event.sequence;
			const calculated =
				event.type === PROCESSOR_EVENT_TYPES.COMPLETION
					? 100
					: Math.floor((completedUnits() * 90) / (count * 2));
			const percent = Math.max(lastPercent, Math.min(100, calculated));
			lastPercent = percent;
			const descriptor = PROGRESS_DESCRIPTORS[event.type];
			const snapshot = Object.freeze({
				stage: descriptor.stage,
				percent,
				safeMessage: descriptor.safeMessage,
			});
			const delivery = reportTail.then(() =>
				reportProgress(descriptor.stage, percent, descriptor.safeMessage),
			);
			reportTail = delivery;
			delivery.catch(() => {});
			return delivery.then(() => snapshot);
		},
		snapshot() {
			return Object.freeze({ percent: lastPercent, completed });
		},
	});
}

function awaitContextPortDelivery(context, stage, operation) {
	throwIfAborted(context.signal, stage);
	const remaining = remainingTimeMs(
		context.effectiveDeadlineAt,
		context.clock,
	);
	if (remaining <= 0) {
		throw new ProcessorDeadlineExceededError({ stage });
	}

	return new Promise((resolve, reject) => {
		let settled = false;
		let timer;

		function cleanup() {
			context.signal.removeEventListener("abort", onAbort);
			if (timer !== undefined) context.clock.clearTimeout(timer);
		}

		function settle(callback, value) {
			if (settled) return;
			settled = true;
			cleanup();
			callback(value);
		}

		function onAbort() {
			try {
				throwIfAborted(context.signal, stage);
			} catch (error) {
				settle(reject, error);
			}
		}

		context.signal.addEventListener("abort", onAbort, { once: true });
		timer = context.clock.setTimeout(
			() =>
				settle(
					reject,
					new ProcessorDeadlineExceededError({ stage }),
				),
			Math.max(0, remaining),
		);

		if (context.signal.aborted) {
			onAbort();
			return;
		}

		let delivery;
		try {
			delivery = operation();
		} catch (error) {
			settle(reject, error);
			return;
		}
		// Both handlers remain attached after cancellation/deadline wins, so a
		// late transport rejection is always observed rather than unhandled.
		Promise.resolve(delivery).then(
			(value) => settle(resolve, value),
			(error) => settle(reject, error),
		);
	});
}

/**
 * Minimal composition for the immutable processor context. Events reach the
 * event port before the aggregator reports their derived global progress.
 */
export function createContextProcessorEventStream(
	context,
	{ variantCount = 3 } = {},
) {
	if (!context || typeof context !== "object") {
		throw new TypeError("processor context is required.");
	}
	const aggregator = createProcessorProgressAggregator({
		reportProgress: (...args) =>
			awaitContextPortDelivery(context, "processor-progress-delivery", () =>
				context.reportProgress(...args),
			),
		variantCount,
	});
	const stream = createProcessorEventStream({
		variantCount,
		async emitProcessorEvent(event) {
			await awaitContextPortDelivery(
				context,
				"processor-event-delivery",
				() => context.emitProcessorEvent(event),
			);
			await aggregator.consume(event);
		},
	});
	return Object.freeze({ stream, progress: aggregator });
}

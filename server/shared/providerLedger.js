import { ProcessorBudgetExceededError } from "./errors.js";

export class ProviderLedgerInvariantError extends Error {
	constructor(message) {
		super(message);
		this.name = "ProviderLedgerInvariantError";
	}
}

const LIMIT_FIELDS = [
	"maxCalls",
	"maxInputTokens",
	"maxOutputTokens",
	"maxCostMicros",
];
const EXPOSURE_FIELDS = ["inputTokens", "outputTokens", "costMicros"];

function requireNonNegativeInteger(value, name) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function requireRequestId(requestId) {
	if (typeof requestId !== "string" || !requestId.trim()) {
		throw new TypeError("Provider reservation requestId is required.");
	}
	return requestId.trim();
}

function requireAttemptId(attemptId) {
	if (typeof attemptId !== "string" || !attemptId.trim()) {
		throw new TypeError("Provider ledger attemptId is required.");
	}
	return attemptId.trim();
}

function cloneEntry(entry) {
	return Object.freeze({
		requestId: entry.requestId,
		kind: entry.kind,
		state: entry.state,
		dispatched: entry.dispatched,
		worstCase: Object.freeze({ ...entry.worstCase }),
		trustedUsage: entry.trustedUsage
			? Object.freeze({ ...entry.trustedUsage })
			: null,
	});
}

function completeTrustedUsage(usage) {
	return (
		usage &&
		EXPOSURE_FIELDS.every((field) => Number.isSafeInteger(usage[field])) &&
		EXPOSURE_FIELDS.every((field) => usage[field] >= 0)
	);
}

export function createProviderLedger(configuredLimits) {
	if (!configuredLimits || typeof configuredLimits !== "object") {
		throw new TypeError("Provider ledger limits are required.");
	}
	const attemptId = requireAttemptId(configuredLimits.attemptId);
	const limits = Object.freeze(
		Object.fromEntries(
			LIMIT_FIELDS.map((field) => [
				field,
				requireNonNegativeInteger(configuredLimits[field], field),
			]),
		),
	);
	if (limits.maxCalls === 0) {
		throw new TypeError("maxCalls must be greater than zero.");
	}

	const entries = new Map();
	const totals = {
		calls: 0,
		inputTokens: 0,
		outputTokens: 0,
		costMicros: 0,
	};

	function requireEntry(requestId) {
		const id = requireRequestId(requestId);
		const entry = entries.get(id);
		if (!entry) throw new Error(`Unknown provider reservation: ${id}`);
		return entry;
	}

	function reserve({ requestId, kind = "provider", worstCase, stage } = {}) {
		const id = requireRequestId(requestId);
		if (entries.has(id)) {
			throw new Error(`Duplicate provider reservation: ${id}`);
		}
		if (!worstCase || typeof worstCase !== "object") {
			throw new TypeError("Provider worstCase exposure is required.");
		}
		const exposure = Object.freeze(
			Object.fromEntries(
				EXPOSURE_FIELDS.map((field) => [
					field,
					requireNonNegativeInteger(worstCase[field], `worstCase.${field}`),
				]),
			),
		);
		const next = {
			calls: totals.calls + 1,
			inputTokens: totals.inputTokens + exposure.inputTokens,
			outputTokens: totals.outputTokens + exposure.outputTokens,
			costMicros: totals.costMicros + exposure.costMicros,
		};
		if (
			next.calls > limits.maxCalls ||
			next.inputTokens > limits.maxInputTokens ||
			next.outputTokens > limits.maxOutputTokens ||
			next.costMicros > limits.maxCostMicros
		) {
			throw new ProcessorBudgetExceededError({ stage });
		}

		Object.assign(totals, next);
		const entry = {
			requestId: id,
			kind: typeof kind === "string" && kind.trim() ? kind.trim() : "provider",
			state: "reserved",
			dispatched: false,
			worstCase: exposure,
			trustedUsage: null,
		};
		entries.set(id, entry);
		return cloneEntry(entry);
	}

	function markDispatched(requestId) {
		const entry = requireEntry(requestId);
		if (entry.state !== "reserved" && entry.state !== "dispatched") {
			throw new Error(
				`Provider reservation ${entry.requestId} cannot be dispatched from ${entry.state}.`,
			);
		}
		entry.dispatched = true;
		entry.state = "dispatched";
		return cloneEntry(entry);
	}

	function releaseUndispatched(requestId) {
		const entry = requireEntry(requestId);
		if (entry.state === "released") return cloneEntry(entry);
		if (entry.dispatched || entry.state !== "reserved") {
			throw new Error(
				`Provider reservation ${entry.requestId} may have been dispatched and cannot be released.`,
			);
		}
		totals.calls -= 1;
		totals.inputTokens -= entry.worstCase.inputTokens;
		totals.outputTokens -= entry.worstCase.outputTokens;
		totals.costMicros -= entry.worstCase.costMicros;
		entry.state = "released";
		return cloneEntry(entry);
	}

	function settle(requestId, { trustedUsage } = {}) {
		const entry = requireEntry(requestId);
		if (entry.state === "reconciled" || entry.state === "retained") {
			return cloneEntry(entry);
		}
		if (!entry.dispatched || entry.state !== "dispatched") {
			throw new Error(
				`Provider reservation ${entry.requestId} was not dispatched.`,
			);
		}

		if (!completeTrustedUsage(trustedUsage)) {
			entry.state = "retained";
			return cloneEntry(entry);
		}
		for (const field of EXPOSURE_FIELDS) {
			if (trustedUsage[field] > entry.worstCase[field]) {
				entry.state = "retained";
				throw new ProviderLedgerInvariantError(
					`Trusted provider usage exceeded reserved ${field}.`,
				);
			}
		}

		const usage = Object.freeze(
			Object.fromEntries(
				EXPOSURE_FIELDS.map((field) => [field, trustedUsage[field]]),
			),
		);
		totals.inputTokens -= entry.worstCase.inputTokens - usage.inputTokens;
		totals.outputTokens -= entry.worstCase.outputTokens - usage.outputTokens;
		totals.costMicros -= entry.worstCase.costMicros - usage.costMicros;
		entry.trustedUsage = usage;
		entry.state = "reconciled";
		return cloneEntry(entry);
	}

	function snapshot() {
		return Object.freeze({
			attemptId,
			limits,
			totals: Object.freeze({ ...totals }),
			entries: Object.freeze([...entries.values()].map(cloneEntry)),
		});
	}

	return Object.freeze({
		attemptId,
		limits,
		reserve,
		markDispatched,
		releaseUndispatched,
		settle,
		snapshot,
	});
}

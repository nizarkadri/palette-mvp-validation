import {
	capTimeoutMs,
	effectiveDeadlineAt,
	remainingTimeMs,
	systemClock,
	throwIfDeadlineExceeded,
	validateClock,
} from "./deadlines.js";
import { throwIfAborted } from "./errors.js";
import { isCanonicalModelProfile } from "./modelProfiles.js";

function requireNonEmptyString(value, name) {
	if (typeof value !== "string" || !value.trim()) {
		throw new TypeError(`${name} is required.`);
	}
	return value.trim();
}

function requireMethod(port, method, name) {
	if (!port || typeof port[method] !== "function") {
		throw new TypeError(`${name} must provide ${method}().`);
	}
}

function isAbortSignal(signal) {
	return (
		signal &&
		typeof signal.aborted === "boolean" &&
		typeof signal.addEventListener === "function" &&
		typeof signal.removeEventListener === "function"
	);
}

function isDeepFrozenJsonLike(value, ancestors = new Set()) {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return true;
	}
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value !== "object" || ancestors.has(value)) return false;
	if (!Object.isFrozen(value)) return false;

	const isArray = Array.isArray(value);
	const prototype = Object.getPrototypeOf(value);
	if (!isArray && prototype !== Object.prototype && prototype !== null) {
		return false;
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (
		Object.getOwnPropertySymbols(value).length > 0 ||
		Object.entries(descriptors).some(([key, descriptor]) => {
			if (isArray && key === "length") return false;
			return !descriptor.enumerable || !("value" in descriptor);
		})
	) {
		return false;
	}
	if (isArray && Object.keys(value).length !== value.length) return false;

	ancestors.add(value);
	const valid = Object.values(value).every((nested) =>
		isDeepFrozenJsonLike(nested, ancestors),
	);
	ancestors.delete(value);
	return valid;
}

function validateIdentity(identity) {
	if (!identity || typeof identity !== "object") {
		throw new TypeError("processor identity is required.");
	}
	const fenceToken = identity.fenceToken;
	if (!Number.isSafeInteger(fenceToken) || fenceToken < 0) {
		throw new TypeError(
			"identity.fenceToken must be a non-negative safe integer.",
		);
	}
	return Object.freeze({
		jobId: requireNonEmptyString(identity.jobId, "identity.jobId"),
		attemptId: requireNonEmptyString(identity.attemptId, "identity.attemptId"),
		fenceToken,
	});
}

function validateLogger(logger) {
	for (const method of ["info", "warn", "error"]) {
		requireMethod(logger, method, "logger");
	}
	return logger;
}

function validateProviderLedger(providerLedger, attemptId) {
	for (const method of [
		"reserve",
		"markDispatched",
		"releaseUndispatched",
		"settle",
		"snapshot",
	]) {
		requireMethod(providerLedger, method, "providerLedger");
	}
	if (providerLedger.attemptId !== attemptId) {
		throw new TypeError(
			"providerLedger attemptId does not match processor identity.",
		);
	}
	return providerLedger;
}

export function createProcessorContext({
	identity,
	signal,
	applicationDeadlineAt,
	absoluteJobDeadlineAt,
	providerLedger,
	modelProfile,
	modelProfileRevision,
	logger,
	reportProgress,
	emitProcessorEvent,
	diagnostics,
	artifactStore,
	checkpointStore,
	clock = systemClock,
} = {}) {
	const frozenIdentity = validateIdentity(identity);
	if (!isAbortSignal(signal)) {
		throw new TypeError("processor context requires an AbortSignal.");
	}
	validateClock(clock);
	const deadlineAt = effectiveDeadlineAt({
		applicationDeadlineAt,
		absoluteJobDeadlineAt,
	});
	validateProviderLedger(providerLedger, frozenIdentity.attemptId);
	if (!modelProfile || !isDeepFrozenJsonLike(modelProfile)) {
		throw new TypeError(
			"modelProfile must be deeply frozen JSON-like server-owned data.",
		);
	}
	if (!isCanonicalModelProfile(modelProfile)) {
		throw new TypeError(
			"modelProfile must be a canonical server-owned job profile.",
		);
	}
	const revision = requireNonEmptyString(
		modelProfileRevision,
		"modelProfileRevision",
	);
	if (modelProfile.revision !== revision) {
		throw new TypeError(
			"modelProfile revision does not match context revision.",
		);
	}
	validateLogger(logger);
	if (typeof reportProgress !== "function") {
		throw new TypeError("reportProgress must be a function.");
	}
	if (typeof emitProcessorEvent !== "function") {
		throw new TypeError("emitProcessorEvent must be a function.");
	}
	requireMethod(diagnostics, "record", "diagnostics");
	requireMethod(artifactStore, "create", "artifactStore");
	requireMethod(checkpointStore, "createCompleted", "checkpointStore");

	return Object.freeze({
		identity: frozenIdentity,
		signal,
		applicationDeadlineAt,
		absoluteJobDeadlineAt,
		effectiveDeadlineAt: deadlineAt,
		providerLedger,
		modelProfile,
		modelProfileRevision: revision,
		logger,
		reportProgress,
		emitProcessorEvent,
		diagnostics,
		artifactStore,
		checkpointStore,
		clock,
	});
}

export function assertProcessorActive(context, stage) {
	if (!context || typeof context !== "object") {
		throw new TypeError("processor context is required.");
	}
	throwIfAborted(context.signal, stage);
	throwIfDeadlineExceeded(context.effectiveDeadlineAt, context.clock, stage);
}

export function processorRemainingTimeMs(context) {
	return remainingTimeMs(context.effectiveDeadlineAt, context.clock);
}

export function capProcessorTimeoutMs(context, configuredTimeoutMs, stage) {
	return capTimeoutMs(
		configuredTimeoutMs,
		context.effectiveDeadlineAt,
		context.clock,
		stage,
	);
}

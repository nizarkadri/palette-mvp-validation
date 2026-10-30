import { randomUUID } from "node:crypto";
import {
	createInMemoryArtifactStore,
	createInMemoryCheckpointStore,
	createNoopDiagnostics,
	createRedactedInMemoryDiagnostics,
} from "../pipeline/ports.js";
import { systemClock } from "../shared/deadlines.js";
import { ProcessorCancelledError } from "../shared/errors.js";
import {
	DEFAULT_MODEL_PROFILE_ID,
	resolveModelProfile,
} from "../shared/modelProfiles.js";
import { createProcessorContext } from "../shared/processorContext.js";
import { createProviderLedger } from "../shared/providerLedger.js";

const APPLICATION_TIMEOUT_MS = 10 * 60 * 1000;
const ABSOLUTE_JOB_TIMEOUT_MS = 15 * 60 * 1000;
let nextFenceToken = 0;

const safeLogger = Object.freeze({
	info() {},
	warn() {},
	error() {},
});

function nextIdentity(jobKind) {
	nextFenceToken = (nextFenceToken + 1) % Number.MAX_SAFE_INTEGER;
	return Object.freeze({
		jobId: `local-${jobKind}-${randomUUID()}`,
		attemptId: `local-attempt-${randomUUID()}`,
		fenceToken: nextFenceToken,
	});
}

function requirePort(callback, name) {
	if (callback === undefined) return async () => {};
	if (typeof callback !== "function") {
		throw new TypeError(`${name} must be a function.`);
	}
	return callback;
}

/**
 * Owns transport cancellation and creates isolated immutable contexts for one
 * raw Connect request/response pair. Request aborts and premature response
 * closes cancel processor work; a response close after end is normal.
 */
export function createLocalProcessorAdapter(
	req,
	res,
	{
		clock = systemClock,
		development = process.env.NODE_ENV !== "production",
	} = {},
) {
	const controller = new AbortController();
	const requestStartedAt = clock.now();
	const absoluteJobDeadlineAt = requestStartedAt + ABSOLUTE_JOB_TIMEOUT_MS;
	let disposed = false;

	function abort(stage) {
		if (!controller.signal.aborted) {
			controller.abort(new ProcessorCancelledError({ stage }));
		}
	}

	function onAborted() {
		abort("request-aborted");
	}

	function onResponseClose() {
		if (
			res?.writableEnded === true ||
			res?.finished === true ||
			res?.ended === true
		) {
			return;
		}
		abort("response-closed");
	}

	if (req && typeof req.once === "function") req.once("aborted", onAborted);
	if (res && typeof res.once === "function") res.once("close", onResponseClose);
	// Register first and then check to close the race between construction and
	// listener installation.
	if (req?.aborted === true) onAborted();

	function createContext({
		jobKind,
		modelProfile = resolveModelProfile(jobKind, DEFAULT_MODEL_PROFILE_ID),
		reportProgress,
		emitProcessorEvent,
		diagnostics,
	} = {}) {
		if (disposed) throw new Error("Local processor adapter is already disposed.");
		if (modelProfile.jobKind !== jobKind) {
			throw new TypeError("Local processor model profile has the wrong job kind.");
		}
		const identity = nextIdentity(jobKind);
		const providerLedger = createProviderLedger({
			attemptId: identity.attemptId,
			...modelProfile.attemptLedgerCeilings,
		});
		return createProcessorContext({
			identity,
			signal: controller.signal,
			applicationDeadlineAt: clock.now() + APPLICATION_TIMEOUT_MS,
			absoluteJobDeadlineAt,
			providerLedger,
			modelProfile,
			modelProfileRevision: modelProfile.revision,
			logger: safeLogger,
			reportProgress: requirePort(reportProgress, "reportProgress"),
			emitProcessorEvent: requirePort(
				emitProcessorEvent,
				"emitProcessorEvent",
			),
			diagnostics: development
				? diagnostics || createRedactedInMemoryDiagnostics({ clock })
				: createNoopDiagnostics(),
			artifactStore: createInMemoryArtifactStore(),
			checkpointStore: createInMemoryCheckpointStore(),
			clock,
		});
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		if (req && typeof req.removeListener === "function") {
			req.removeListener("aborted", onAborted);
		}
		if (res && typeof res.removeListener === "function") {
			res.removeListener("close", onResponseClose);
		}
	}

	return Object.freeze({ signal: controller.signal, createContext, dispose });
}

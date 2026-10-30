import { providerSemaphore } from "./concurrency.js";
import {
	assertProcessorActive,
	capProcessorTimeoutMs,
} from "./processorContext.js";

export async function executeProviderRequest({
	context,
	semaphore = providerSemaphore,
	reservation,
	configuredTimeoutMs,
	dispatch,
	getTrustedUsage,
	stage = "provider-request",
} = {}) {
	if (!reservation || typeof reservation !== "object") {
		throw new TypeError("Provider reservation details are required.");
	}
	if (typeof dispatch !== "function") {
		throw new TypeError("Provider dispatch must be a function.");
	}
	if (getTrustedUsage !== undefined && typeof getTrustedUsage !== "function") {
		throw new TypeError("getTrustedUsage must be a function when provided.");
	}

	assertProcessorActive(context, stage);
	const releasePermit = await semaphore.acquire({
		signal: context.signal,
		deadlineAt: context.effectiveDeadlineAt,
		stage,
		clock: context.clock,
	});
	let reserved = false;
	let dispatched = false;
	let settled = false;
	let retentionAttempted = false;
	let primaryError = null;

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
			// Some foreign errors may be non-extensible; preserve the primary anyway.
		}
	}

	function logSecondaryFailure(message, secondaryError, error = primaryError) {
		attachSecondaryError(error, message, secondaryError);
		try {
			context.logger.error(message, {
				requestId: reservation.requestId,
				cause: secondaryError,
			});
		} catch (loggerError) {
			attachSecondaryError(error, "Secondary failure logging failed.", loggerError);
		}
	}

	function retainWorstCase(error = primaryError) {
		if (!dispatched || settled || retentionAttempted) return;
		retentionAttempted = true;
		try {
			context.providerLedger.settle(reservation.requestId);
			settled = true;
		} catch (cleanupError) {
			logSecondaryFailure("Provider ledger cleanup failed.", cleanupError, error);
		}
	}

	try {
		context.providerLedger.reserve({ ...reservation, stage });
		reserved = true;
		assertProcessorActive(context, stage);
		const timeoutMs = capProcessorTimeoutMs(
			context,
			configuredTimeoutMs,
			stage,
		);
		context.providerLedger.markDispatched(reservation.requestId);
		dispatched = true;

		let response;
		try {
			response = await dispatch({
				signal: context.signal,
				timeoutMs,
				applicationDeadlineAt: context.applicationDeadlineAt,
				absoluteJobDeadlineAt: context.absoluteJobDeadlineAt,
				effectiveDeadlineAt: context.effectiveDeadlineAt,
				modelProfile: context.modelProfile,
			});
		} catch (error) {
			retainWorstCase(error);
			throw error;
		}

		let trustedUsage;
		try {
			trustedUsage = getTrustedUsage?.(response);
			context.providerLedger.settle(reservation.requestId, { trustedUsage });
			settled = true;
		} catch (error) {
			retainWorstCase(error);
			throw error;
		}

		assertProcessorActive(context, stage);
		return response;
	} catch (error) {
		primaryError = error;
		if (reserved && !dispatched) {
			try {
				context.providerLedger.releaseUndispatched(reservation.requestId);
			} catch (cleanupError) {
				logSecondaryFailure(
					"Provider ledger cleanup failed.",
					cleanupError,
					error,
				);
			}
		} else {
			retainWorstCase(error);
		}
		throw error;
	} finally {
		try {
			releasePermit();
		} catch (releaseError) {
			if (!primaryError) throw releaseError;
			logSecondaryFailure(
				"Provider semaphore release failed.",
				releaseError,
				primaryError,
			);
		}
	}
}

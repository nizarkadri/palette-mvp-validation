import { processAnalysis } from "../pipeline/analysis.js";
import { createRedactedInMemoryDiagnostics } from "../pipeline/ports.js";
import {
	correctFrameFitIfNeeded,
	evaluateRenderedCandidate,
	publicVariant,
	renderAndEvaluateCandidate,
	scoreVariant,
} from "../services/visualVerifier.js";
import { generateCandidate } from "../services/screenshotGenerator.js";
import { readJsonBody, sendJson, sendStreamEvent, setupNdjsonStream } from "../utils/stream.js";
import {
	createDebugSession,
	writeDebugImage,
	writeDebugJson,
} from "../utils/debug.js";
import { createLocalProcessorAdapter } from "./processorAdapter.js";

const INCOMPLETE_ANALYSIS_ERROR =
	"Analysis could not complete all three variants.";
const VARIANT_FAILURE_ERROR = "Variant generation failed.";
const SAFE_ANALYSIS_ERRORS = new Set([
	"Invalid JSON request body.",
	"Request body too large.",
	INCOMPLETE_ANALYSIS_ERROR,
]);
const MAX_LOCAL_CAUSE_MESSAGE_LENGTH = 8 * 1024;

function localErrorMessage(error) {
	try {
		if (typeof error?.message === "string" && error.message.trim()) {
			return error.message.trim().slice(0, MAX_LOCAL_CAUSE_MESSAGE_LENGTH);
		}
		if (typeof error === "string" && error.trim()) {
			return error.trim().slice(0, MAX_LOCAL_CAUSE_MESSAGE_LENGTH);
		}
	} catch {
		// Foreign provider errors may expose throwing accessors.
	}
	return null;
}

function deepestLocalCauseMessage(error) {
	let current = error;
	let message = null;
	const seen = new Set();
	while (
		current !== null &&
		current !== undefined &&
		(typeof current === "object" || typeof current === "function") &&
		!seen.has(current)
	) {
		seen.add(current);
		message = localErrorMessage(current) || message;
		try {
			current = current.cause;
		} catch {
			break;
		}
	}
	return localErrorMessage(current) || message;
}

function createDevelopmentVariantDiagnostics(failures) {
	const redacted = createRedactedInMemoryDiagnostics();
	return Object.freeze({
		async record(entry) {
			const record = await redacted.record(entry);
			if (
				Number.isInteger(entry?.variantIndex) &&
				entry.variantIndex >= 0 &&
				entry.variantIndex < 3 &&
				entry.error !== undefined
			) {
				failures.set(entry.variantIndex, entry.error);
			}
			return record;
		},
		list: redacted.list,
	});
}

function publicAnalysisError(error) {
	const message = error?.message;
	return SAFE_ANALYSIS_ERRORS.has(message) ? message : "Analysis failed.";
}

function analysisServices(session) {
	return {
		generateCandidate: (options) => generateCandidate({ ...options, session }),
		renderAndEvaluateCandidate: (options) =>
			renderAndEvaluateCandidate({ ...options, session }),
		correctFrameFitIfNeeded: (options) =>
			correctFrameFitIfNeeded({ ...options, session }),
		evaluateRenderedCandidate: (options) =>
			evaluateRenderedCandidate({ ...options, session }),
		publicVariant,
		scoreVariant,
	};
}

export function createAnalyzeStreamRoute(env) {
	return async function analyzeStreamRoute(req, res) {
		if (req.method !== "POST") {
			res.setHeader("Allow", "POST");
			sendJson(res, 405, { error: "Method not allowed." });
			return;
		}

		const apiKey = env.OPENROUTER_API_KEY;
		if (!apiKey) {
			sendJson(res, 500, {
				error: "Missing OPENROUTER_API_KEY on the local server.",
			});
			return;
		}

		setupNdjsonStream(res);
		const development = process.env.NODE_ENV !== "production";
		const variantFailureDetails = development ? new Map() : null;
		const variantDiagnostics = variantFailureDetails
			? createDevelopmentVariantDiagnostics(variantFailureDetails)
			: undefined;
		const adapter = createLocalProcessorAdapter(req, res, { development });
		let session = null;
		let terminalSent = false;
		const pendingEvents = [];
		const generatedByIndex = new Map();
		const failureIndexes = new Set();

		function emitFailure(index) {
			failureIndexes.add(index);
			sendStreamEvent(res, {
				type: "variant.failed",
				variantId: `variant-${index + 1}`,
				index: index + 1,
				error: VARIANT_FAILURE_ERROR,
			});
		}

		async function emitProcessorEvent(event) {
			pendingEvents.push(event);
		}

		async function reportProgress(_stage, percent) {
			const event = pendingEvents.shift();
			if (!event) {
				sendStreamEvent(res, {
					type: "progress",
					message: "Generating 3 variants...",
					progress: percent,
				});
				return;
			}

			if (event.type === "generation") {
				generatedByIndex.set(event.variantIndex, event.output);
				sendStreamEvent(res, {
					type: "variant.generated",
					variant: event.output,
					progress: percent,
				});
				return;
			}
			if (event.type === "evaluation") {
				const generated = generatedByIndex.get(event.variantIndex) || {};
				const score = Number(event.evaluation?.score);
				generatedByIndex.set(event.variantIndex, {
					...generated,
					score: Number.isFinite(score) ? score : generated.score,
					visualEvaluation: event.evaluation,
				});
				sendStreamEvent(res, {
					type: "variant.evaluated",
					variantId: `variant-${event.variantIndex + 1}`,
					score: Number.isFinite(score) ? score : generated.score,
					visualEvaluation: event.evaluation,
					renderedScreenshot: generated.renderedScreenshot,
					frameFit: generated.frameFit,
					progress: percent,
				});
				return;
			}
			if (event.type === "failure") {
				emitFailure(event.variantIndex);
				return;
			}
			if (event.type === "completion") {
				const summary = [...generatedByIndex.entries()]
					.sort(([left], [right]) => left - right)
					.map(([index, variant]) => ({
						variant: index + 1,
						modelId: variant.modelId,
						issues: variant.issues,
						score: variant.score,
						renderedScreenshot:
							variant.renderedScreenshot?.relativePath || null,
						frameFit: variant.frameFit || null,
						frameFitCorrected: Boolean(variant.frameFitCorrected),
						visualEvaluation: variant.visualEvaluation,
						selected: index === event.recommendedVariantIndex,
					}));
				await writeDebugJson(session, "generation-variants-summary.json", summary);
				sendStreamEvent(res, {
					type: "complete",
					recommendedVariantId: `variant-${event.recommendedVariantIndex + 1}`,
					debug: { debugId: session.id, debugPath: session.relativeDir },
					progress: 100,
				});
				terminalSent = true;
				res.end();
			}
		}

		try {
			const { base64, mediaType = "image/png" } = await readJsonBody(req);
			if (typeof base64 !== "string" || base64.length === 0) {
				sendStreamEvent(res, {
					type: "error",
					error: "Missing screenshot image data.",
				});
				terminalSent = true;
				res.end();
				return;
			}

			session = await createDebugSession();
			await writeDebugJson(session, "request-meta.json", {
				mediaType,
				base64Length: base64.length,
				createdAt: new Date().toISOString(),
			});
			await writeDebugImage(session, base64, mediaType);

			const context = adapter.createContext({
				jobKind: "analysis",
				reportProgress,
				emitProcessorEvent,
				diagnostics: variantDiagnostics,
			});
			await context.reportProgress("preparing", 8, "Generating variants.");
			const result = await processAnalysis(
				{ base64, mediaType },
				context,
				{ apiKey, services: analysisServices(session) },
			);

			const failed = result.outcomes.filter(
				(outcome) => outcome.status === "failed",
			);
			if (failed.length > 0) {
				for (const outcome of failed) {
					if (!failureIndexes.has(outcome.index)) emitFailure(outcome.index);
				}
				try {
					await writeDebugJson(
						session,
						"generation-variant-errors.json",
						failed.map((outcome) => ({
							variant: outcome.index + 1,
							modelId:
								context.modelProfile.variants[outcome.index].provider.modelId,
							message:
								deepestLocalCauseMessage(
									variantFailureDetails?.get(outcome.index),
								) || outcome.safeMessage,
						})),
					);
				} catch {
					// Development diagnostics must not replace the processor result.
				}
				sendStreamEvent(res, {
					type: "error",
					error: INCOMPLETE_ANALYSIS_ERROR,
				});
				terminalSent = true;
				res.end();
				return;
			}

			if (!terminalSent) {
				throw new Error("Analysis completed without a terminal event.");
			}
		} catch (error) {
			if (session) {
				try {
					await writeDebugJson(session, "analysis-error.json", {
						message: error?.message || String(error),
					});
				} catch {
					// A diagnostics failure must not replace the public terminal error.
				}
			}
			if (!terminalSent) {
				sendStreamEvent(res, {
					type: "error",
					error: publicAnalysisError(error),
				});
				terminalSent = true;
				res.end();
			}
		} finally {
			adapter.dispose();
		}
	};
}

import { processAnalysis } from "../pipeline/analysis.js";
import { processCategorization } from "../pipeline/categorization.js";
import { categorizeHtmlForPalette } from "../services/categorization.js";
import { generateCandidate } from "../services/screenshotGenerator.js";
import {
	correctFrameFitIfNeeded,
	evaluateRenderedCandidate,
	publicVariant,
	renderAndEvaluateCandidate,
	scoreVariant,
} from "../services/visualVerifier.js";
import { readJsonBody, sendJson } from "../utils/stream.js";
import {
	createDebugSession,
	writeDebugImage,
	writeDebugJson,
	writeDebugText,
} from "../utils/debug.js";
import { createLocalProcessorAdapter } from "./processorAdapter.js";

const INCOMPLETE_ANALYSIS_ERROR =
	"Analysis could not complete all three variants.";
const SAFE_ANALYSIS_ERRORS = new Set([
	"Invalid JSON request body.",
	"Request body too large.",
	INCOMPLETE_ANALYSIS_ERROR,
]);

function publicAnalysisError(error) {
	const message = error?.message;
	return SAFE_ANALYSIS_ERRORS.has(message) ? message : "Analysis failed.";
}

function analysisServices(session, candidates) {
	function remember(operation) {
		return async (options) => {
			const candidate = await operation({ ...options, session });
			if (candidate?.variantIndex !== undefined) {
				candidates.set(candidate.variantIndex, candidate);
			}
			return candidate;
		};
	}
	return {
		generateCandidate: remember(generateCandidate),
		renderAndEvaluateCandidate: remember(renderAndEvaluateCandidate),
		correctFrameFitIfNeeded: remember(correctFrameFitIfNeeded),
		evaluateRenderedCandidate: remember(evaluateRenderedCandidate),
		publicVariant,
		scoreVariant,
	};
}

export function createAnalyzeRoute(env) {
	return async function analyzeRoute(req, res) {
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

		const adapter = createLocalProcessorAdapter(req, res);
		let debugSession = null;
		let requestContext = null;

		async function ensureDebugSession() {
			if (!debugSession) {
				debugSession = await createDebugSession();
				if (requestContext) {
					await writeDebugJson(debugSession, "request-meta.json", {
						mediaType: requestContext.mediaType,
						base64Length: requestContext.base64.length,
						createdAt: new Date().toISOString(),
					});
					await writeDebugImage(
						debugSession,
						requestContext.base64,
						requestContext.mediaType,
					);
				}
			}
			return debugSession;
		}

		try {
			const { base64, mediaType = "image/png" } = await readJsonBody(req);
			if (typeof base64 !== "string" || base64.length === 0) {
				sendJson(res, 400, { error: "Missing screenshot image data." });
				return;
			}

			requestContext = { base64, mediaType };
			const session = await ensureDebugSession();
			const candidates = new Map();
			const analysisContext = adapter.createContext({ jobKind: "analysis" });
			const analysis = await processAnalysis(
				{ base64, mediaType },
				analysisContext,
				{ apiKey, services: analysisServices(session, candidates) },
			);
			if (
				analysis.outcomes.length !== 3 ||
				analysis.outcomes.some((outcome) => outcome.status !== "complete") ||
				!analysis.recommendedVariant
			) {
				throw new Error(INCOMPLETE_ANALYSIS_ERROR);
			}

			const selectedIndex = analysis.recommendedVariantIndex;
			const selectedCandidate = candidates.get(selectedIndex);
			const selected = analysis.recommendedVariant;
			const generationDebug = {
				selectedVariant: selectedIndex + 1,
				variantCount: analysis.outcomes.length,
				visualCorrected: Boolean(selectedCandidate?.visualCorrected),
				frameFitCorrected: Boolean(selected.frameFitCorrected),
				frameFit: selected.frameFit || null,
				visualScore: selected.score,
				visualVerificationAvailable: analysis.outcomes.some(
					(outcome) => Boolean(outcome.variant?.renderedScreenshot),
				),
			};
			await writeDebugJson(session, "generation-response.json", {
				...generationDebug,
				issues: selected.issues,
				response: selectedCandidate?.generation?.data,
			});
			await writeDebugJson(
				session,
				"generation-tool-events.json",
				selectedCandidate?.generation?.toolEvents || [],
			);
			await writeDebugText(session, "generated.html", selected.html);

			let semanticDebug = {};
			const categorizationContext = adapter.createContext({
				jobKind: "categorization",
			});
			const categorized = await processCategorization(
				{ html: selected.html, base64, mediaType },
				categorizationContext,
				{
					apiKey,
					services: {
						async categorizeHtmlForPalette(options) {
							const value = await categorizeHtmlForPalette({
								...options,
								session,
							});
							semanticDebug = value.semanticDebug || {};
							return value;
						},
					},
				},
			);
			const result = { html: categorized.html, elements: categorized.elements };
			await writeDebugJson(session, "generated-elements.json", result.elements);
			await writeDebugJson(session, "final-result.json", result);

			sendJson(res, 200, {
				...result,
				debug: {
					debugId: session.id,
					debugPath: session.relativeDir,
					...generationDebug,
					...semanticDebug,
				},
			});
		} catch (error) {
			let session = debugSession;
			try {
				session = await ensureDebugSession();
				await writeDebugJson(session, "analysis-error.json", {
					message: error?.message || String(error),
				});
			} catch {
				// A diagnostics failure must not replace the public route error.
			}

			sendJson(res, 500, {
				error: publicAnalysisError(error),
				...(session
					? { debugId: session.id, debugPath: session.relativeDir }
					: {}),
			});
		} finally {
			adapter.dispose();
		}
	};
}

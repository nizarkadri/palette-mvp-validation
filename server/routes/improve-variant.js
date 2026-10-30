import { processImprovement } from "../pipeline/improvement.js";
import {
	DEFAULT_MODEL_PROFILE_ID,
	ModelProfileResolutionError,
	resolveLegacyImprovementModelProfile,
	resolveModelProfile,
} from "../shared/modelProfiles.js";
import {
	correctCandidateWithVisualFeedback,
	publicVariant,
	renderAndEvaluateCandidate,
} from "../services/visualVerifier.js";
import { readJsonBody, sendJson } from "../utils/stream.js";
import {
	createDebugSession,
	writeDebugImage,
	writeDebugJson,
	writeDebugText,
} from "../utils/debug.js";
import { createLocalProcessorAdapter } from "./processorAdapter.js";

const MODEL_NOT_ALLOWED_ERROR = "Requested model is not available.";

function resolveImprovementProfile(rawModelId, configuredModelId) {
	if (rawModelId !== undefined) {
		if (typeof rawModelId !== "string") {
			throw new ModelProfileResolutionError();
		}
		if (rawModelId.trim()) {
			return resolveLegacyImprovementModelProfile(rawModelId);
		}
	}
	if (typeof configuredModelId === "string" && configuredModelId.trim()) {
		return resolveLegacyImprovementModelProfile(configuredModelId);
	}
	return resolveModelProfile("improvement", DEFAULT_MODEL_PROFILE_ID);
}

export function createImproveVariantRoute(env) {
	return async function improveVariantRoute(req, res) {
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
		try {
			const {
				html,
				base64,
				mediaType = "image/png",
				variantId = "source-variant",
				modelId,
			} = await readJsonBody(req);

			if (typeof html !== "string" || html.trim() === "") {
				sendJson(res, 400, { error: "Missing generated HTML." });
				return;
			}
			if (typeof base64 !== "string" || base64.length === 0) {
				sendJson(res, 400, { error: "Missing screenshot image data." });
				return;
			}

			let modelProfile;
			try {
				modelProfile = resolveImprovementProfile(
					modelId,
					env.OPENROUTER_MODEL_ID,
				);
			} catch (error) {
				if (!(error instanceof ModelProfileResolutionError)) throw error;
				sendJson(res, 400, { error: MODEL_NOT_ALLOWED_ERROR });
				return;
			}

			const session = await createDebugSession();
			await writeDebugJson(session, "request-meta.json", {
				mediaType,
				base64Length: base64.length,
				variantId,
				modelId: modelProfile.provider.modelId,
				createdAt: new Date().toISOString(),
			});
			await writeDebugImage(session, base64, mediaType);
			await writeDebugText(session, "source-variant.html", html);

			const context = adapter.createContext({
				jobKind: "improvement",
				modelProfile,
			});
			const improved = await processImprovement(
				{ html, base64, mediaType },
				context,
				{
					apiKey,
					services: {
						renderAndEvaluateCandidate: (options) =>
							renderAndEvaluateCandidate({ ...options, session }),
						correctCandidateWithVisualFeedback: (options) =>
							correctCandidateWithVisualFeedback({ ...options, session }),
						publicVariant,
					},
				},
			);

			sendJson(res, 200, {
				...improved,
				debug: {
					debugId: session.id,
					debugPath: session.relativeDir,
					variantId,
				},
			});
		} catch (error) {
			sendJson(res, 500, {
				error: error.message || "Variant improvement failed.",
			});
		} finally {
			adapter.dispose();
		}
	};
}

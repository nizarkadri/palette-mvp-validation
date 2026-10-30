import { processCategorization } from "../pipeline/categorization.js";
import { categorizeHtmlForPalette } from "../services/categorization.js";
import { readJsonBody, sendJson } from "../utils/stream.js";
import {
	createDebugSession,
	writeDebugImage,
	writeDebugJson,
	writeDebugText,
} from "../utils/debug.js";
import { createLocalProcessorAdapter } from "./processorAdapter.js";

export function createCategorizeRoute(env) {
	return async function categorizeRoute(req, res) {
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
				variantId = "selected-variant",
			} = await readJsonBody(req);
			if (typeof html !== "string" || html === "") {
				sendJson(res, 400, { error: "Missing generated HTML." });
				return;
			}
			if (typeof base64 !== "string" || base64.length === 0) {
				sendJson(res, 400, { error: "Missing screenshot image data." });
				return;
			}

			const session = await createDebugSession();
			await writeDebugJson(session, "request-meta.json", {
				mediaType,
				base64Length: base64.length,
				variantId,
				createdAt: new Date().toISOString(),
			});
			await writeDebugImage(session, base64, mediaType);
			await writeDebugText(session, "selected-variant.html", html);

			let semanticDebug = {};
			const context = adapter.createContext({ jobKind: "categorization" });
			const categorized = await processCategorization(
				{ html, base64, mediaType },
				context,
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
					variantId,
					...semanticDebug,
				},
			});
		} catch (error) {
			sendJson(res, 500, {
				error: error.message || "Categorization failed.",
			});
		} finally {
			adapter.dispose();
		}
	};
}

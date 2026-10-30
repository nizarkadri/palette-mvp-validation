import { processCustomSwatchAnalysis } from "../pipeline/customSwatch.js";
import { readJsonBody, sendJson } from "../utils/stream.js";
import { createLocalProcessorAdapter } from "./processorAdapter.js";

export function createCustomSwatchRoute(env) {
	return async function customSwatchRoute(req, res) {
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
				base64,
				mediaType = "image/png",
				swatch = {},
				elements = [],
				palette = {},
			} = await readJsonBody(req);
			if (typeof base64 !== "string" || base64.length === 0) {
				sendJson(res, 400, { error: "Missing selected variant screenshot." });
				return;
			}

			const context = adapter.createContext({ jobKind: "custom-swatch" });
			const result = await processCustomSwatchAnalysis(
				{ base64, mediaType, swatch, elements, palette },
				context,
				{ apiKey },
			);
			sendJson(res, 200, result);
		} catch (error) {
			sendJson(res, 500, {
				error: error.message || "Custom swatch visual analysis failed.",
			});
		} finally {
			adapter.dispose();
		}
	};
}

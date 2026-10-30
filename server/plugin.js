import { createAnalyzeRoute } from "./routes/analyze.js";
import { createAnalyzeStreamRoute } from "./routes/analyze-stream.js";
import { createCategorizeRoute } from "./routes/categorize.js";
import { createColorBrainRoute } from "./routes/colorbrain.js";
import { createCustomSwatchRoute } from "./routes/custom-swatch.js";
import { createImproveVariantRoute } from "./routes/improve-variant.js";

export function analyzeApiPlugin(env) {
	return {
		name: "local-analyze-api",
		configureServer(server) {
			server.middlewares.use(
				"/api/colorbrain/anchors",
				createColorBrainRoute(env),
			);
			server.middlewares.use("/api/categorize", createCategorizeRoute(env));
			server.middlewares.use(
				"/api/improve-variant",
				createImproveVariantRoute(env),
			);
			server.middlewares.use(
				"/api/custom-swatch/analyze",
				createCustomSwatchRoute(env),
			);
			server.middlewares.use(
				"/api/analyze-stream",
				createAnalyzeStreamRoute(env),
			);
			server.middlewares.use("/api/analyze", createAnalyzeRoute(env));
		},
	};
}

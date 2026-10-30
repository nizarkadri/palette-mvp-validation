import { describe, expect, it } from "vitest";
import { publicVariant, selectBestVariant } from "../visualVerifier.js";

describe("publicVariant", () => {
	it("includes browser-usable rendered screenshot data, not only debug paths", () => {
		const variant = publicVariant({
			variantIndex: 0,
			modelId: "test-model",
			html: "<main>Hello</main>",
			issues: [],
			visualEvaluation: null,
			renderedScreenshot: {
				relativePath: "debug/analysis/example/variant-1.png",
				base64: "abc123",
				mediaType: "image/png",
				fitDiagnostics: { fits: true },
			},
		});

		expect(variant.renderedScreenshot).toEqual({
			relativePath: "debug/analysis/example/variant-1.png",
			base64: "abc123",
			mediaType: "image/png",
		});
		expect(variant.frameFit).toEqual({ fits: true });
	});

	it("breaks equal-score ties by stable variant index, not completion order", () => {
		const candidates = [2, 0, 1].map((variantIndex) => ({
			variantIndex,
			issues: [],
			visualEvaluation: { score: 90 },
			renderedScreenshot: null,
		}));

		expect(selectBestVariant(candidates).variantIndex).toBe(0);
	});
});

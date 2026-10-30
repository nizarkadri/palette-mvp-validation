import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import VariantPicker, { getImageSrc } from "../VariantPicker.jsx";

describe("VariantPicker getImageSrc", () => {
	it("uses screenshot objects with base64 as browser-ready data URLs", () => {
		expect(
			getImageSrc({
				base64: "abc123",
				mediaType: "image/png",
				relativePath: "debug/analysis/example/variant-1.png",
			}),
		).toBe("data:image/png;base64,abc123");
	});

	it("uses relative screenshot paths as URL paths instead of treating them as base64", () => {
		expect(getImageSrc("debug/analysis/example/variant-1.png")).toBe(
			"/debug/analysis/example/variant-1.png",
		);
		expect(
			getImageSrc({ relativePath: "debug/analysis/example/variant-1.png" }),
		).toBe("/debug/analysis/example/variant-1.png");
	});

	it("keeps already browser-ready URLs unchanged", () => {
		expect(getImageSrc("data:image/png;base64,abc123")).toBe(
			"data:image/png;base64,abc123",
		);
		expect(getImageSrc("https://example.com/variant.png")).toBe(
			"https://example.com/variant.png",
		);
	});

	it("treats plain strings without path markers as raw base64", () => {
		expect(getImageSrc("abc123")).toBe("data:image/png;base64,abc123");
	});
});

describe("VariantPicker display labels", () => {
	it("numbers visible variants by display order instead of backend index", () => {
		const html = renderToStaticMarkup(
			React.createElement(VariantPicker, {
				variants: [
					{ id: "variant-3", index: 3, html: "<main />" },
					{ id: "variant-5", index: 5, html: "<main />" },
				],
				selectedVariantId: "variant-3",
				recommendedVariantId: "variant-5",
				isGenerating: false,
				isCategorizing: false,
				statusMessage: "",
				progressPercent: 100,
			}),
		);

		expect(html).toContain("Variant 1");
		expect(html).toContain("Variant 2");
		expect(html).not.toContain("Variant 3");
		expect(html).not.toContain("Variant 5");
		expect(html).toContain("Recommended");
		expect(html).toContain("Preview");
		expect(html).not.toContain("ti-arrows-maximize");
		expect(html).toContain("Select");
		expect(html).toContain("Improve");
		expect(html).toContain("this layout becomes your editable workspace");
		expect(html).not.toContain("variant-selected-preview");
		expect(html).not.toContain("variant-preview-popover");
	});

	it("labels and highlights improved variants", () => {
		const html = renderToStaticMarkup(
			React.createElement(VariantPicker, {
				variants: [
					{ id: "variant-1", index: 1, html: "<main />" },
					{
						id: "variant-1-improved-123",
						index: 2,
						html: "<main />",
						isImproved: true,
						parentVariantId: "variant-1",
					},
				],
				selectedVariantId: "variant-1",
				recommendedVariantId: null,
				isGenerating: false,
				isCategorizing: false,
				highlightedVariantId: "variant-1-improved-123",
			}),
		);

		expect(html).toContain("variant-card improved highlighted");
		expect(html).toContain("Improved");
		expect(html).toContain("from Variant 1");
	});
});

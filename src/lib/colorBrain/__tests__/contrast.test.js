import { beforeAll, describe, expect, it } from "vitest";
import { loadModule } from "./testUtils.js";

let contrast;

beforeAll(async () => {
	contrast = await loadModule("../contrast.js");
});

describe("colorBrain contrast foundation", () => {
	it("computes WCAG contrast ratios using known extremes", () => {
		expect(contrast.contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
		expect(contrast.contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
		expect(contrast.contrastRatio("#777777", "#777777")).toBeCloseTo(1, 2);
	});

	it("uses 4.5:1 for normal text and 3:1 for large text thresholds", () => {
		expect(contrast.passesNormalText("#111827", "#ffffff")).toBe(true);
		expect(contrast.passesLargeText("#767676", "#ffffff")).toBe(true);
		expect(contrast.passesNormalText("#aaaaaa", "#ffffff")).toBe(false);
	});

	it("chooses a readable foreground for any background", () => {
		expect(contrast.bestReadableColor("#050505")).toBe("#ffffff");
		expect(contrast.bestReadableColor("#f8fafc")).toBe("#000000");

		["#d4ff00", "#ff00d4", "#4c1d95", "#2dd4bf"].forEach((background) => {
			const foreground = contrast.bestReadableColor(background);
			expect(["#ffffff", "#000000"]).toContain(foreground);
			expect(
				contrast.contrastRatio(foreground, background),
			).toBeGreaterThanOrEqual(4.5);
		});
	});

	it("returns stable relative luminance values for black, white, and mid colors", () => {
		expect(contrast.relativeLuminance("#000000")).toBeCloseTo(0, 5);
		expect(contrast.relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
		expect(contrast.relativeLuminance("#808080")).toBeGreaterThan(0);
		expect(contrast.relativeLuminance("#808080")).toBeLessThan(1);
	});
});

import { beforeAll, describe, expect, it } from "vitest";
import { expectHex, loadModule } from "./testUtils.js";

let anchors;

beforeAll(async () => {
	anchors = await loadModule("../anchors.js");
});

describe("colorBrain creative anchor generation", () => {
	it("generates the requested number of local anchor palettes", () => {
		const result = anchors.generateAnchorPalettes({
			count: 12,
			seedColor: "#6366f1",
			creativity: "balanced",
			randomSeed: "anchors-balanced",
		});

		expect(result).toHaveLength(12);
		result.forEach((palette) => {
			expect(palette).toEqual(
				expect.objectContaining({
					id: expect.any(String),
					source: expect.any(String),
					strategy: expect.any(String),
					creativeColors: expect.any(Array),
				}),
			);
			expect(palette.creativeColors.length).toBeGreaterThanOrEqual(5);
			palette.creativeColors.forEach(expectHex);
		});
	});

	it("is deterministic when the same randomSeed is used", () => {
		const input = {
			count: 8,
			seedColor: "#14b8a6",
			creativity: "expressive",
			randomSeed: "same-seed",
		};

		expect(anchors.generateAnchorPalettes(input)).toEqual(
			anchors.generateAnchorPalettes(input),
		);
	});

	it("keeps locked colors in generated creative palettes", () => {
		const lockedColors = ["#ff00d4", "#050505"];
		const result = anchors.generateAnchorPalettes({
			count: 6,
			lockedColors,
			creativity: "wild",
			randomSeed: "locked-colors",
		});

		result.forEach((palette) => {
			const lower = palette.creativeColors.map((color) => color.toLowerCase());
			lockedColors.forEach((locked) => expect(lower).toContain(locked));
		});
	});

	it("makes wild palettes more chromatic than safe palettes on average", () => {
		const safe = anchors.generateAnchorPalettes({
			count: 20,
			seedColor: "#6366f1",
			creativity: "safe",
			randomSeed: "creativity-comparison",
		});
		const wild = anchors.generateAnchorPalettes({
			count: 20,
			seedColor: "#6366f1",
			creativity: "wild",
			randomSeed: "creativity-comparison",
		});

		expect(anchors.averagePaletteChroma(wild)).toBeGreaterThan(
			anchors.averagePaletteChroma(safe),
		);
	});
});

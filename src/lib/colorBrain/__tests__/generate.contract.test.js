import { beforeAll, describe, expect, it } from "vitest";
import {
	expectLegacyPaletteShape,
	expectMinimumUiContrast,
	expectRichPaletteShape,
	loadModule,
	originalColorWasPreserved,
} from "./testUtils.js";

let colorBrain;
let contrast;

beforeAll(async () => {
	colorBrain = await loadModule("../index.js");
	contrast = await loadModule("../contrast.js");
});

describe("colorBrain generator contract", () => {
	it("returns the requested number of rich palettes and legacy app-compatible palettes", () => {
		const result = colorBrain.generateColorBrainPalettes({
			count: 24,
			seedColor: "#6366f1",
			creativity: "balanced",
			theme: "light",
			randomSeed: "contract-basic",
		});

		expect(result.palettes).toHaveLength(24);
		expect(result.legacyPalettes).toHaveLength(24);
		expect(result.diagnostics).toEqual(
			expect.objectContaining({
				generatedAnchors: expect.any(Number),
				generatedRecipes: expect.any(Number),
				mappingCandidates: expect.any(Number),
				repairedCandidates: expect.any(Number),
				hardGateRejected: expect.any(Number),
				similarRejected: expect.any(Number),
				returned: 24,
			}),
		);

		result.palettes.forEach((palette) => {
			expectRichPaletteShape(palette);
			expect(palette.dedupe).toEqual(
				expect.objectContaining({
					fingerprint: expect.any(String),
					similarRecentCount: expect.any(Number),
				}),
			);
		});
		result.legacyPalettes.forEach(expectLegacyPaletteShape);
	});

	it("never returns a no-valid-palette state, even for intentionally difficult anchors", () => {
		const difficultAnchors = [
			["#d4ff00", "#eaff00", "#fffb00", "#c8ff00", "#f6ff5c"],
			["#050505", "#080808", "#0a0a0a", "#101010", "#141414"],
			["#ff00d4", "#00f5ff", "#d4ff00", "#ff6b00", "#8b5cf6"],
		];

		const result = colorBrain.generateColorBrainPalettes({
			count: 12,
			anchorPalettes: difficultAnchors.map((creativeColors, index) => ({
				id: `difficult-${index}`,
				source: "test",
				strategy: "difficult",
				creativeColors,
			})),
			creativity: "wild",
			theme: "light",
			randomSeed: "difficult-contract",
		});

		expect(result.palettes).toHaveLength(12);
		result.palettes.forEach((palette) => {
			expect(palette.status).toBe("valid");
			expect(palette.status).not.toBe("rejected");
			expectMinimumUiContrast(contrast, palette.roles);
		});
	});

	it("preserves creative identity by keeping at least one original anchor in a meaningful role", () => {
		const result = colorBrain.generateColorBrainPalettes({
			count: 16,
			seedColor: "#fa5c7c",
			creativity: "expressive",
			theme: "light",
			randomSeed: "identity-preservation",
		});

		result.palettes.forEach((palette) => {
			expect(
				originalColorWasPreserved(palette.creativeColors, palette.roles),
			).toBe(true);
		});
	});

	it("caps API-anchor output at five palettes per anchor for better variety", () => {
		const anchorPalettes = [
			["#0f172a", "#f8fafc", "#38bdf8", "#818cf8", "#f472b6"],
			["#1c1917", "#fff7ed", "#fb923c", "#dc2626", "#facc15"],
			["#052e16", "#f0fdf4", "#22c55e", "#14b8a6", "#a3e635"],
			["#312e81", "#eef2ff", "#6366f1", "#a855f7", "#ec4899"],
			["#083344", "#ecfeff", "#06b6d4", "#3b82f6", "#84cc16"],
			["#451a03", "#fffbeb", "#f59e0b", "#ea580c", "#65a30d"],
		].map((creativeColors, index) => ({
			id: `anchor-${index}`,
			source: "test",
			strategy: "fixture",
			creativeColors,
		}));

		const result = colorBrain.generateColorBrainPalettes({
			count: 30,
			anchorPalettes,
			maxPalettesPerAnchor: 5,
			creativity: "balanced",
			theme: "auto",
			randomSeed: "anchor-cap-contract",
		});
		const perAnchorCounts = result.palettes.reduce((counts, palette) => {
			counts[palette.anchorId] = (counts[palette.anchorId] || 0) + 1;
			return counts;
		}, {});

		expect(result.palettes).toHaveLength(30);
		expect(result.legacyPalettes).toHaveLength(30);
		expect(result.diagnostics.maxPalettesPerAnchor).toBe(5);
		expect(Object.values(perAnchorCounts)).toEqual([5, 5, 5, 5, 5, 5]);
	});

	it("supports all creativity modes with the same hard accessibility guarantees", () => {
		["safe", "balanced", "expressive", "wild"].forEach((creativity) => {
			const result = colorBrain.generateColorBrainPalettes({
				count: 10,
				seedColor: "#14b8a6",
				creativity,
				theme: "auto",
				randomSeed: `mode-${creativity}`,
			});

			expect(result.palettes).toHaveLength(10);
			result.palettes.forEach((palette) => {
				expect(palette.creativity).toBe(creativity);
				expectMinimumUiContrast(contrast, palette.roles);
			});
		});
	});

	it("is reproducible for the same randomSeed and different for different randomSeed values", () => {
		const input = {
			count: 8,
			seedColor: "#4c1d95",
			creativity: "balanced",
			theme: "dark",
		};
		const first = colorBrain.generateColorBrainPalettes({
			...input,
			randomSeed: "stable",
		});
		const second = colorBrain.generateColorBrainPalettes({
			...input,
			randomSeed: "stable",
		});
		const third = colorBrain.generateColorBrainPalettes({
			...input,
			randomSeed: "different",
		});

		expect(first.legacyPalettes).toEqual(second.legacyPalettes);
		expect(first.legacyPalettes).not.toEqual(third.legacyPalettes);
	});
});

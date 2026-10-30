import { beforeAll, describe, expect, it } from "vitest";
import { loadModule } from "./testUtils.js";

let roleMapping;

beforeAll(async () => {
	roleMapping = await loadModule("../roleMapping.js");
});

describe("colorBrain role mapping", () => {
	const creativeColors = [
		"#f8fafc", // light neutral
		"#111827", // dark text candidate
		"#6366f1", // primary candidate
		"#2dd4bf", // secondary candidate
		"#fa5c7c", // accent candidate
	];

	it("creates many mapping candidates instead of trusting palette order", () => {
		const candidates = roleMapping.createRoleMappingCandidates(creativeColors, {
			theme: "light",
			creativity: "balanced",
		});

		expect(candidates.length).toBeGreaterThan(20);
		candidates.forEach((candidate) => {
			expect(candidate).toEqual(
				expect.objectContaining({
					backgroundSeed: expect.any(String),
					textSeed: expect.any(String),
					primarySeed: expect.any(String),
					secondarySeed: expect.any(String),
					accentSeed: expect.any(String),
				}),
			);
		});
	});

	it("includes heuristic mappings that prefer neutral background and dark text in light mode", () => {
		const candidates = roleMapping.createRoleMappingCandidates(creativeColors, {
			theme: "light",
			creativity: "balanced",
		});

		expect(
			candidates.some(
				(candidate) =>
					candidate.backgroundSeed.toLowerCase() === "#f8fafc" &&
					candidate.textSeed.toLowerCase() === "#111827",
			),
		).toBe(true);
	});

	it("includes heuristic mappings that prefer dark background and light text in dark mode", () => {
		const candidates = roleMapping.createRoleMappingCandidates(creativeColors, {
			theme: "dark",
			creativity: "balanced",
		});

		expect(
			candidates.some(
				(candidate) =>
					candidate.backgroundSeed.toLowerCase() === "#111827" &&
					candidate.textSeed.toLowerCase() === "#f8fafc",
			),
		).toBe(true);
	});

	it("deduplicates mappings so scoring does not waste time", () => {
		const candidates = roleMapping.createRoleMappingCandidates(creativeColors, {
			theme: "light",
			creativity: "balanced",
		});
		const keys = candidates.map((candidate) =>
			[
				candidate.backgroundSeed,
				candidate.textSeed,
				candidate.primarySeed,
				candidate.secondarySeed,
				candidate.accentSeed,
			]
				.map((color) => color.toLowerCase())
				.join("|"),
		);

		expect(new Set(keys).size).toBe(keys.length);
	});
});

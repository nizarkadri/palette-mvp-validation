import { beforeAll, describe, expect, it } from "vitest";
import {
	expectHex,
	expectMinimumUiContrast,
	loadModule,
	originalColorWasPreserved,
} from "./testUtils.js";

let contrast;
let deriveTokens;
let repair;
let score;

beforeAll(async () => {
	contrast = await loadModule("../contrast.js");
	deriveTokens = await loadModule("../deriveTokens.js");
	repair = await loadModule("../repair.js");
	score = await loadModule("../score.js");
});

describe("colorBrain token derivation, repair, and scoring", () => {
	const creativeColors = [
		"#d4ff00",
		"#ff00d4",
		"#00f5ff",
		"#050505",
		"#ffffff",
	];

	it("derives a rich UI token set from a mapping candidate", () => {
		const roles = deriveTokens.deriveUiTokens(
			{
				backgroundSeed: "#ffffff",
				textSeed: "#050505",
				primarySeed: "#00f5ff",
				secondarySeed: "#d4ff00",
				accentSeed: "#ff00d4",
			},
			{ theme: "light", creativity: "expressive", creativeColors },
		);

		[
			"background",
			"surface",
			"surfaceElevated",
			"text",
			"mutedText",
			"border",
			"primary",
			"onPrimary",
			"secondary",
			"onSecondary",
			"accent",
			"onAccent",
		].forEach((role) => expectHex(roles[role]));
	});

	it("repairs neon or unsafe mappings into accessible UI usage without rejection", () => {
		const unsafeRoles = deriveTokens.deriveUiTokens(
			{
				backgroundSeed: "#d4ff00",
				textSeed: "#00f5ff",
				primarySeed: "#ff00d4",
				secondarySeed: "#ffffff",
				accentSeed: "#d4ff00",
			},
			{ theme: "light", creativity: "wild", creativeColors },
		);

		const repaired = repair.repairUiUsage({
			creativeColors,
			roles: unsafeRoles,
			theme: "light",
			creativity: "wild",
		});

		expect(repaired.status).toBe("valid");
		expect(Array.isArray(repaired.notes)).toBe(true);
		expectMinimumUiContrast(contrast, repaired.roles);
		expect(originalColorWasPreserved(creativeColors, repaired.roles)).toBe(
			true,
		);
	});

	it("converts rich colorBrain roles into the current app legacy palette shape", () => {
		const repaired = repair.repairUiUsage({
			creativeColors,
			roles: deriveTokens.deriveUiTokens(
				{
					backgroundSeed: "#ffffff",
					textSeed: "#050505",
					primarySeed: "#00f5ff",
					secondarySeed: "#d4ff00",
					accentSeed: "#ff00d4",
				},
				{ theme: "light", creativity: "expressive", creativeColors },
			),
			theme: "light",
			creativity: "expressive",
		});
		const legacy = deriveTokens.toLegacyPalette({
			id: "test-palette",
			name: "Test palette",
			creativeColors,
			roles: repaired.roles,
			score: { total: 90 },
		});

		expect(legacy).toEqual(
			expect.objectContaining({
				name: "Test palette",
				primary: repaired.roles.background,
				secondary: repaired.roles.surface,
				accent: repaired.roles.accent,
				text: repaired.roles.text,
				textMuted: repaired.roles.mutedText,
				onAccent: repaired.roles.onAccent,
				_colorBrain: expect.any(Object),
			}),
		);
	});

	it("scores accessibility and creativity without rewarding over-safe palettes too highly", () => {
		const expressiveTheme = repair.repairUiUsage({
			creativeColors,
			roles: deriveTokens.deriveUiTokens(
				{
					backgroundSeed: "#ffffff",
					textSeed: "#050505",
					primarySeed: "#00f5ff",
					secondarySeed: "#d4ff00",
					accentSeed: "#ff00d4",
				},
				{ theme: "light", creativity: "expressive", creativeColors },
			),
			theme: "light",
			creativity: "expressive",
		});
		const boringTheme = repair.repairUiUsage({
			creativeColors: ["#f8fafc", "#e2e8f0", "#cbd5e1", "#64748b", "#334155"],
			roles: deriveTokens.deriveUiTokens(
				{
					backgroundSeed: "#f8fafc",
					textSeed: "#334155",
					primarySeed: "#64748b",
					secondarySeed: "#e2e8f0",
					accentSeed: "#cbd5e1",
				},
				{ theme: "light", creativity: "expressive" },
			),
			theme: "light",
			creativity: "expressive",
		});

		const expressiveScore = score.scoreUiTheme(expressiveTheme, {
			creativity: "expressive",
		});
		const boringScore = score.scoreUiTheme(boringTheme, {
			creativity: "expressive",
		});

		expect(expressiveScore).toEqual(
			expect.objectContaining({
				accessibility: expect.any(Number),
				compatibility: expect.any(Number),
				roleFit: expect.any(Number),
				moodCoherence: expect.any(Number),
				prototype: expect.any(Number),
				surfaceHierarchy: expect.any(Number),
				novelty: expect.any(Number),
				chaosPenalty: expect.any(Number),
				boringPenalty: expect.any(Number),
				genericPenalty: expect.any(Number),
			}),
		);
		expect(expressiveScore.accessibility).toBeGreaterThanOrEqual(90);
		expect(expressiveScore.novelty).toBeGreaterThan(boringScore.novelty);
		expect(expressiveScore.visualInterest).toBe(expressiveScore.novelty);
		expect(boringScore.boringPenalty).toBeGreaterThanOrEqual(0);
	});
});

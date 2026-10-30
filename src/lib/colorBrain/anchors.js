import {
	adjustChroma,
	hexToOklch,
	normalizeHex,
	oklchToHex,
	rotateHue,
} from "./colorMath.js";
import { randomBetween, seededRandom } from "./random.js";
import { normalizeCreativityMode } from "./types.js";

const DEFAULT_SEED_COLOR = "#6366f1";

const CREATIVITY_PROFILES = {
	safe: {
		chroma: 0.55,
		lightnessMin: 0.35,
		lightnessMax: 0.85,
		hueJitter: 8,
	},
	balanced: {
		chroma: 0.85,
		lightnessMin: 0.25,
		lightnessMax: 0.9,
		hueJitter: 16,
	},
	expressive: {
		chroma: 1.12,
		lightnessMin: 0.18,
		lightnessMax: 0.94,
		hueJitter: 28,
	},
	wild: {
		chroma: 1.45,
		lightnessMin: 0.08,
		lightnessMax: 0.96,
		hueJitter: 48,
	},
};

const STRATEGIES = [
	"analogous",
	"triadic",
	"split-complement",
	"monochrome",
	"neutral-plus-accent",
	"wild",
];

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function normalizeColorList(colors = []) {
	return colors.map(normalizeHex).filter(Boolean);
}

function createRandomSeedColor(random, profile) {
	return oklchToHex({
		l: randomBetween(profile.lightnessMin, profile.lightnessMax, random),
		c: randomBetween(0.08, 0.22, random) * profile.chroma,
		h: randomBetween(0, 360, random),
	});
}

function colorFromBase(
	base,
	hueOffset,
	lightness,
	chromaMultiplier,
	profile,
	random,
) {
	const rotated = rotateHue(
		base,
		hueOffset + randomBetween(-profile.hueJitter, profile.hueJitter, random),
	);
	const color = hexToOklch(
		adjustChroma(rotated, chromaMultiplier * profile.chroma),
	);

	return oklchToHex({
		...color,
		l: clamp(lightness, profile.lightnessMin, profile.lightnessMax),
	});
}

function createStrategyColors(base, strategy, profile, random) {
	const baseProfile = hexToOklch(base);
	const baseLightness = baseProfile?.l ?? 0.6;

	if (strategy === "monochrome") {
		return [
			colorFromBase(base, 0, 0.94, 0.18, profile, random),
			colorFromBase(base, 0, 0.78, 0.35, profile, random),
			colorFromBase(base, 0, baseLightness, 0.8, profile, random),
			colorFromBase(base, 0, 0.36, 0.7, profile, random),
			colorFromBase(base, 0, 0.12, 0.45, profile, random),
		];
	}

	if (strategy === "neutral-plus-accent") {
		return [
			"#f8fafc",
			"#111827",
			colorFromBase(base, 0, 0.58, 1, profile, random),
			colorFromBase(base, 35, 0.72, 0.7, profile, random),
			colorFromBase(base, -70, 0.64, 1.15, profile, random),
		];
	}

	if (strategy === "triadic") {
		return [
			colorFromBase(base, 0, 0.94, 0.12, profile, random),
			colorFromBase(base, 0, 0.18, 0.35, profile, random),
			colorFromBase(base, 0, 0.58, 1, profile, random),
			colorFromBase(base, 120, 0.66, 0.95, profile, random),
			colorFromBase(base, 240, 0.62, 1.05, profile, random),
		];
	}

	if (strategy === "split-complement") {
		return [
			colorFromBase(base, 0, 0.95, 0.14, profile, random),
			colorFromBase(base, 0, 0.14, 0.28, profile, random),
			colorFromBase(base, 0, 0.56, 1, profile, random),
			colorFromBase(base, 150, 0.68, 1.05, profile, random),
			colorFromBase(base, 210, 0.62, 1.05, profile, random),
		];
	}

	if (strategy === "wild") {
		return [
			colorFromBase(
				base,
				randomBetween(-40, 40, random),
				0.95,
				0.18,
				profile,
				random,
			),
			colorFromBase(
				base,
				randomBetween(160, 220, random),
				0.1,
				0.5,
				profile,
				random,
			),
			colorFromBase(
				base,
				randomBetween(20, 90, random),
				0.62,
				1.2,
				profile,
				random,
			),
			colorFromBase(
				base,
				randomBetween(120, 190, random),
				0.7,
				1.25,
				profile,
				random,
			),
			colorFromBase(
				base,
				randomBetween(240, 330, random),
				0.6,
				1.35,
				profile,
				random,
			),
		];
	}

	return [
		colorFromBase(base, 0, 0.95, 0.12, profile, random),
		colorFromBase(base, 0, 0.16, 0.3, profile, random),
		colorFromBase(base, 0, 0.58, 1, profile, random),
		colorFromBase(base, 32, 0.66, 0.9, profile, random),
		colorFromBase(base, -42, 0.62, 1.05, profile, random),
	];
}

function mergeLockedColors(colors, lockedColors) {
	const result = [...lockedColors];
	colors.forEach((color) => {
		if (
			!result.some((existing) => existing.toLowerCase() === color.toLowerCase())
		) {
			result.push(color);
		}
	});
	return result.slice(0, Math.max(5, lockedColors.length));
}

export function generateAnchorPalettes(options = {}) {
	const count = Math.max(0, options.count ?? 12);
	const creativity = normalizeCreativityMode(options.creativity);
	const profile = CREATIVITY_PROFILES[creativity];
	const random = seededRandom(options.randomSeed ?? `anchors-${creativity}`);
	const lockedColors = normalizeColorList(options.lockedColors);
	const seedColor =
		normalizeHex(options.seedColor) || lockedColors[0] || DEFAULT_SEED_COLOR;

	return Array.from({ length: count }, (_, index) => {
		const strategy = STRATEGIES[index % STRATEGIES.length];
		const base =
			index === 0 ? seedColor : createRandomSeedColor(random, profile);
		const creativeColors = mergeLockedColors(
			createStrategyColors(base, strategy, profile, random),
			lockedColors,
		);

		return {
			id: `local-${creativity}-${index}`,
			source: "local",
			strategy,
			creativeColors,
		};
	});
}

export function averagePaletteChroma(palettes) {
	const colors = palettes.flatMap((palette) => palette.creativeColors ?? []);
	if (colors.length === 0) return 0;

	const total = colors.reduce(
		(sum, color) => sum + (hexToOklch(color)?.c ?? 0),
		0,
	);
	return total / colors.length;
}

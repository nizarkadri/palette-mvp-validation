import {
	adjustLightness,
	hexToOklch,
	mixColors,
	normalizeHex,
	oklchToHex,
} from "./colorMath.js";
import { bestReadableColor } from "./contrast.js";
import { randomBetween, seededRandom } from "./random.js";
import { normalizeCreativityMode } from "./types.js";

const DEFAULT_SEED_COLOR = "#6366f1";

const CREATIVITY_CHROMA = {
	safe: 0.82,
	balanced: 1,
	expressive: 1.16,
	wild: 1.32,
};

const RECIPES = [
	{
		id: "soft-editorial",
		label: "Soft editorial",
		mood: "editorial",
		mode: "light",
		hueLogic: "analogous",
		background: { l: [0.95, 0.99], c: [0.004, 0.028] },
		accent: { l: [0.5, 0.68], c: [0.12, 0.23], offset: [-20, 32] },
		secondary: { l: [0.62, 0.78], c: [0.04, 0.11], offset: [28, 58] },
	},
	{
		id: "dark-premium",
		label: "Dark premium",
		mood: "premium",
		mode: "dark",
		hueLogic: "mono-pop",
		background: { l: [0.08, 0.15], c: [0.006, 0.035] },
		accent: { l: [0.62, 0.82], c: [0.09, 0.2], offset: [-8, 24] },
		secondary: { l: [0.28, 0.42], c: [0.03, 0.09], offset: [24, 52] },
	},
	{
		id: "warm-minimal",
		label: "Warm minimal",
		mood: "calm",
		mode: "light",
		hueLogic: "neutral-plus-accent",
		background: { l: [0.94, 0.985], c: [0.01, 0.04], hue: [52, 86] },
		accent: { l: [0.46, 0.62], c: [0.1, 0.2], offset: [-16, 24] },
		secondary: { l: [0.68, 0.82], c: [0.035, 0.09], offset: [30, 72] },
	},
	{
		id: "fresh-saas",
		label: "Fresh SaaS",
		mood: "product",
		mode: "light",
		hueLogic: "split-complement",
		background: { l: [0.96, 0.995], c: [0.002, 0.025] },
		accent: { l: [0.48, 0.64], c: [0.13, 0.25], offset: [-10, 18] },
		secondary: { l: [0.58, 0.76], c: [0.07, 0.15], offset: [135, 165] },
	},
	{
		id: "pastel-product",
		label: "Pastel product",
		mood: "playful",
		mode: "light",
		hueLogic: "analogous",
		background: { l: [0.93, 0.98], c: [0.018, 0.05] },
		accent: { l: [0.66, 0.78], c: [0.08, 0.16], offset: [-34, 36] },
		secondary: { l: [0.76, 0.86], c: [0.045, 0.11], offset: [38, 78] },
	},
	{
		id: "bold-pop",
		label: "Bold pop",
		mood: "playful",
		mode: "light",
		hueLogic: "warm-cool",
		background: { l: [0.95, 0.99], c: [0.0, 0.025] },
		accent: { l: [0.48, 0.68], c: [0.18, 0.31], offset: [-18, 28] },
		secondary: { l: [0.56, 0.74], c: [0.1, 0.2], offset: [165, 205] },
	},
	{
		id: "earthy-organic",
		label: "Earthy organic",
		mood: "organic",
		mode: "light",
		hueLogic: "analogous",
		background: { l: [0.91, 0.97], c: [0.018, 0.05], hue: [70, 105] },
		accent: { l: [0.42, 0.58], c: [0.08, 0.17], hue: [115, 155] },
		secondary: { l: [0.52, 0.68], c: [0.045, 0.11], hue: [38, 72] },
	},
	{
		id: "mono-luxe",
		label: "Mono luxe",
		mood: "premium",
		mode: "dark",
		hueLogic: "mono-pop",
		background: { l: [0.07, 0.13], c: [0.0, 0.025] },
		accent: { l: [0.68, 0.84], c: [0.055, 0.13], offset: [-6, 12] },
		secondary: { l: [0.24, 0.38], c: [0.02, 0.07], offset: [0, 22] },
	},
	{
		id: "high-contrast-neon",
		label: "High contrast neon",
		mood: "energetic",
		mode: "dark",
		hueLogic: "split-complement",
		background: { l: [0.055, 0.12], c: [0.004, 0.028] },
		accent: { l: [0.68, 0.86], c: [0.17, 0.32], offset: [-30, 32] },
		secondary: { l: [0.62, 0.78], c: [0.1, 0.22], offset: [145, 205] },
	},
	{
		id: "calm-healthcare",
		label: "Calm healthcare",
		mood: "calm",
		mode: "light",
		hueLogic: "analogous",
		background: { l: [0.95, 0.99], c: [0.004, 0.028], hue: [175, 225] },
		accent: { l: [0.46, 0.62], c: [0.09, 0.18], hue: [175, 215] },
		secondary: { l: [0.68, 0.82], c: [0.045, 0.105], hue: [145, 178] },
	},
	{
		id: "fintech-blue-green",
		label: "Fintech blue-green",
		mood: "trustworthy",
		mode: "light",
		hueLogic: "warm-cool",
		background: { l: [0.955, 0.995], c: [0.002, 0.026], hue: [195, 235] },
		accent: { l: [0.44, 0.6], c: [0.12, 0.24], hue: [205, 245] },
		secondary: { l: [0.5, 0.68], c: [0.08, 0.18], hue: [150, 180] },
	},
	{
		id: "creative-portfolio",
		label: "Creative portfolio",
		mood: "creative",
		mode: "light",
		hueLogic: "near-complementary",
		background: { l: [0.93, 0.985], c: [0.006, 0.04] },
		accent: { l: [0.48, 0.68], c: [0.16, 0.29], offset: [-24, 42] },
		secondary: { l: [0.54, 0.72], c: [0.08, 0.18], offset: [120, 170] },
	},
];

function hueFromRange(range, random) {
	return randomBetween(range[0], range[1], random);
}

function normalizeHue(hue) {
	return ((hue % 360) + 360) % 360;
}

function channelHue(rule, baseHue, random) {
	if (rule.hue) return hueFromRange(rule.hue, random);
	const offset = rule.offset ?? [0, 0];
	return normalizeHue(baseHue + randomBetween(offset[0], offset[1], random));
}

function colorFromRule(rule, baseHue, random, chromaMultiplier = 1) {
	return oklchToHex({
		l: randomBetween(rule.l[0], rule.l[1], random),
		c: randomBetween(rule.c[0], rule.c[1], random) * chromaMultiplier,
		h: channelHue(rule, baseHue, random),
	});
}

function readableMutedText(text, background) {
	for (const amount of [0.42, 0.36, 0.3, 0.24, 0.18, 0.12]) {
		const candidate = mixColors(text, background, amount);
		if (candidate !== text) return candidate;
	}
	return adjustLightness(text, hexToOklch(background)?.l > 0.5 ? 0.18 : -0.18);
}

function recipeTheme(recipe, requestedTheme, index) {
	if (requestedTheme === "light" || requestedTheme === "dark")
		return requestedTheme;
	return recipe.mode ?? (index % 2 === 0 ? "light" : "dark");
}

function createSurface(background, theme) {
	return theme === "dark"
		? mixColors(background, "#ffffff", 0.075)
		: mixColors(background, "#ffffff", 0.74);
}

function createRecipeCandidate(recipe, options, index, random) {
	const creativity = normalizeCreativityMode(options.creativity);
	const chromaMultiplier = CREATIVITY_CHROMA[creativity] ?? 1;
	const seed = normalizeHex(options.seedColor) || DEFAULT_SEED_COLOR;
	const seedProfile = hexToOklch(seed);
	const baseHue = normalizeHue(
		(seedProfile?.h ?? 250) + randomBetween(-18, 18, random),
	);
	const theme = recipeTheme(recipe, options.theme, index);
	const recipeForTheme =
		theme === recipe.mode
			? recipe
			: {
					...recipe,
					background:
						theme === "dark"
							? { ...recipe.background, l: [0.07, 0.16], c: [0.004, 0.035] }
							: { ...recipe.background, l: [0.94, 0.99], c: [0.002, 0.04] },
				};

	const background = colorFromRule(
		recipeForTheme.background,
		baseHue,
		random,
		1,
	);
	const surface = createSurface(background, theme);
	const accent =
		index === 0
			? seed
			: colorFromRule(recipeForTheme.accent, baseHue, random, chromaMultiplier);
	const secondary = colorFromRule(
		recipeForTheme.secondary,
		baseHue,
		random,
		Math.max(0.75, chromaMultiplier * 0.82),
	);
	const text = bestReadableColor(background);
	const mutedText = readableMutedText(text, background);
	const border = mixColors(text, background, theme === "dark" ? 0.72 : 0.84);

	return {
		id: `recipe-${recipe.id}-${index}`,
		name: recipe.label,
		source: "local-recipe",
		strategy: "recipe-based-ui-theme",
		recipe: recipe.id,
		recipeLabel: recipe.label,
		mood: recipe.mood,
		hueLogic: recipe.hueLogic,
		creativity,
		theme,
		creativeColors: [background, surface, accent, text, mutedText, secondary],
		visibleRoles: {
			background,
			surface,
			accent,
			text,
			muted: mutedText,
		},
		roles: {
			background,
			surface,
			surfaceElevated:
				theme === "dark"
					? mixColors(surface, "#ffffff", 0.06)
					: mixColors(surface, "#ffffff", 0.5),
			text,
			mutedText,
			border,
			primary: accent,
			primaryHover: adjustLightness(accent, theme === "dark" ? 0.06 : -0.06),
			onPrimary: bestReadableColor(accent),
			secondary,
			onSecondary: bestReadableColor(secondary),
			accent,
			onAccent: bestReadableColor(accent),
		},
		notes: [`Generated from the ${recipe.label} recipe.`],
	};
}

export function getPaletteRecipes() {
	return RECIPES.map((recipe) => ({ ...recipe }));
}

export function generateRecipeThemeCandidates(options = {}) {
	const count = Math.max(0, options.count ?? 40);
	const random = seededRandom(options.randomSeed ?? "recipe-palettes");

	return Array.from({ length: count }, (_, index) => {
		const recipe = RECIPES[index % RECIPES.length];
		return createRecipeCandidate(recipe, options, index, random);
	});
}

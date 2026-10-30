import { hexToOklch } from "./colorMath.js";
import { contrastRatio } from "./contrast.js";

const WEIGHTS = {
	accessibility: 0.22,
	roleFit: 0.2,
	compatibility: 0.16,
	moodCoherence: 0.14,
	prototype: 0.12,
	surfaceHierarchy: 0.08,
	novelty: 0.08,
};

function clampScore(value) {
	return Math.round(Math.min(100, Math.max(0, value)));
}

function clampPenalty(value) {
	return Math.round(Math.min(30, Math.max(0, value)));
}

function profile(color) {
	return hexToOklch(color) ?? { l: 0, c: 0, h: 0 };
}

function visibleRoleColors(roles) {
	return [
		roles.background,
		roles.surface,
		roles.accent,
		roles.text,
		roles.mutedText,
	].filter(Boolean);
}

function averageChroma(colors) {
	const profiles = colors.map(hexToOklch).filter(Boolean);
	if (profiles.length === 0) return 0;
	return profiles.reduce((sum, color) => sum + color.c, 0) / profiles.length;
}

function hueDistance(a, b) {
	const first = hexToOklch(a);
	const second = hexToOklch(b);
	if (!first || !second) return 0;
	const diff = Math.abs(first.h - second.h) % 360;
	return Math.min(diff, 360 - diff);
}

function scoreContrastPair(foreground, background, target) {
	return Math.min(1, contrastRatio(foreground, background) / target);
}

function scoreAccessibility(roles) {
	const checks = [
		scoreContrastPair(roles.text, roles.background, 4.5),
		scoreContrastPair(roles.text, roles.surface, 4.5),
		scoreContrastPair(roles.onAccent, roles.accent, 4.5),
		scoreContrastPair(roles.onPrimary, roles.primary, 4.5),
		scoreContrastPair(roles.onSecondary, roles.secondary, 4.5),
		scoreContrastPair(roles.mutedText, roles.background, 3),
	].filter((value) => Number.isFinite(value));

	return clampScore(
		(checks.reduce((sum, value) => sum + value, 0) / checks.length) * 100,
	);
}

function scoreRoleFit(roles, creativity) {
	const background = profile(roles.background);
	const surface = profile(roles.surface);
	const accent = profile(roles.accent);
	const text = profile(roles.text);
	const muted = profile(roles.mutedText);
	const isDark = background.l < 0.35;
	let score = 100;

	if (isDark) {
		if (background.l > 0.22) score -= 14;
	} else if (background.l < 0.88) {
		score -= 16;
	}

	if (background.c > (creativity === "wild" ? 0.11 : 0.07)) score -= 16;
	if (surface.c > 0.09) score -= 8;
	if (Math.abs(surface.l - background.l) < 0.012) score -= 8;
	if (text.c > 0.08) score -= 10;
	if (muted.c > 0.12) score -= 6;
	if (accent.c < 0.055) score -= 18;
	if (accent.l < 0.24 || accent.l > 0.9) score -= 8;

	return clampScore(score);
}

function scoreCompatibility(roles) {
	const colors = visibleRoleColors(roles);
	const chroma = averageChroma(colors);
	const background = profile(roles.background);
	const surface = profile(roles.surface);
	const accent = profile(roles.accent);
	const text = profile(roles.text);
	const accentTextDistance = hueDistance(roles.accent, roles.text);
	const foundationDistance = hueDistance(roles.background, roles.surface);
	let score = 74;

	// Good UI palettes usually have a quiet foundation and one clear hero color.
	if (background.c <= 0.055 && surface.c <= 0.075) score += 12;
	if (accent.c > background.c + 0.06) score += 10;
	if (Math.abs(text.l - background.l) > 0.55) score += 8;
	if (foundationDistance <= 30) score += 5;
	if (accentTextDistance > 18) score += 5;
	if (chroma > 0.035 && chroma < 0.16) score += 6;

	// Penalize flat or chaotic visible strips.
	if (Math.abs(accent.l - background.l) < 0.12) score -= 10;
	if (colors.map(profile).filter((color) => color.c > 0.16).length > 2)
		score -= 18;

	return clampScore(score);
}

function targetAccentHueForMood(mood, recipe) {
	const value = mood ?? recipe;
	if (["calm", "healthcare", "trustworthy"].includes(value)) return [155, 230];
	if (["premium", "dark-premium", "mono-luxe"].includes(value)) return null;
	if (["organic", "earthy-organic"].includes(value)) return [45, 155];
	if (["playful", "bold-pop", "pastel-product"].includes(value)) return null;
	return null;
}

function scoreMoodCoherence(candidate, options) {
	const recipe = options.recipe ?? candidate.recipe;
	const mood = candidate.mood;
	const roles = candidate.roles;
	const background = profile(roles.background);
	const accent = profile(roles.accent);
	const theme = candidate.theme ?? (background.l < 0.35 ? "dark" : "light");
	let score = 82;

	if (recipe?.includes("dark") || recipe?.includes("luxe")) {
		score += theme === "dark" ? 10 : -12;
		if (accent.c <= 0.2) score += 6;
	}

	if (recipe?.includes("healthcare") || mood === "calm") {
		if (background.c <= 0.04) score += 8;
		if (accent.c <= 0.2) score += 6;
	}

	if (recipe?.includes("bold") || recipe?.includes("neon")) {
		if (accent.c >= 0.14) score += 10;
	}

	const hueTarget = targetAccentHueForMood(mood, recipe);
	if (hueTarget) {
		const hue = accent.h;
		const inRange = hue >= hueTarget[0] && hue <= hueTarget[1];
		score += inRange ? 8 : -6;
	}

	return clampScore(score);
}

function scorePrototype(roles) {
	const checks = [
		scoreContrastPair(roles.text, roles.background, 4.5),
		scoreContrastPair(roles.text, roles.surface, 4.5),
		scoreContrastPair(roles.mutedText, roles.surface, 3),
		scoreContrastPair(roles.onAccent, roles.accent, 4.5),
		scoreContrastPair(roles.border, roles.surface, 1.15),
	].filter((value) => Number.isFinite(value));
	const base =
		(checks.reduce((sum, value) => sum + Math.min(1, value), 0) /
			checks.length) *
		100;
	const accent = profile(roles.accent);
	const background = profile(roles.background);
	const hierarchyBonus = Math.min(10, Math.abs(accent.l - background.l) * 20);

	return clampScore(base + hierarchyBonus);
}

function scoreSurfaceHierarchy(roles) {
	const background = profile(roles.background);
	const surface = profile(roles.surface);
	const elevated = profile(roles.surfaceElevated);
	const text = profile(roles.text);
	const muted = profile(roles.mutedText);
	let score = 70;

	const surfaceDelta = Math.abs(surface.l - background.l);
	const elevatedDelta = Math.abs(elevated.l - surface.l);
	const textMutedDelta = Math.abs(text.l - muted.l);

	if (surfaceDelta >= 0.018 && surfaceDelta <= 0.16) score += 18;
	if (elevatedDelta >= 0.006 && elevatedDelta <= 0.12) score += 8;
	if (textMutedDelta >= 0.12 && textMutedDelta <= 0.42) score += 12;
	if (surfaceDelta > 0.24) score -= 12;
	if (textMutedDelta < 0.08) score -= 10;

	return clampScore(score);
}

function scoreNovelty(candidate, creativity) {
	const roles = candidate.roles;
	const accent = profile(roles.accent);
	const secondary = profile(roles.secondary);
	const background = profile(roles.background);
	const creativeChroma = averageChroma(candidate.creativeColors ?? []);
	const accentDistance = hueDistance(roles.accent, roles.secondary);
	let score = 46;

	score += Math.min(24, accent.c * 120);
	score += Math.min(12, Math.abs(accent.h - background.h) / 18);
	score += Math.min(12, accentDistance / 10);
	score += Math.min(10, creativeChroma * 80);
	if (secondary.c > 0.06 && secondary.c < accent.c + 0.06) score += 6;
	if (creativity === "safe") score -= 8;
	if (creativity === "expressive") score += 5;
	if (creativity === "wild") score += 8;

	return clampScore(score);
}

function chaosPenalty(candidate, creativity) {
	const colors = visibleRoleColors(candidate.roles).map(profile);
	const loudVisible = colors.filter((color) => color.c > 0.15).length;
	const background = profile(candidate.roles.background);
	let penalty = 0;

	if (loudVisible > 1) penalty += (loudVisible - 1) * 8;
	if (background.c > 0.09) penalty += 8;
	if (background.c > 0.13) penalty += 8;
	if (creativity === "wild") penalty *= 0.65;

	return clampPenalty(penalty);
}

function boringPenalty(candidate, creativity) {
	if (creativity === "safe") return 0;
	const roles = candidate.roles;
	const accent = profile(roles.accent);
	const chroma = averageChroma(visibleRoleColors(roles));
	let penalty = 0;

	if (accent.c < 0.065) penalty += 12;
	if (chroma < 0.035) penalty += 10;
	if (hueDistance(roles.accent, roles.secondary) < 10) penalty += 6;

	return clampPenalty(penalty);
}

function genericPenalty(candidate) {
	const background = profile(candidate.roles.background);
	const accent = profile(candidate.roles.accent);
	const isBlueAccent = accent.h >= 215 && accent.h <= 265;
	const isPlainNeutral = background.c < 0.018 && background.l > 0.93;

	return isBlueAccent && isPlainNeutral ? 7 : 0;
}

export function scoreUiTheme(candidate, options = {}) {
	const creativity = options.creativity ?? candidate.creativity ?? "balanced";
	const accessibility = scoreAccessibility(candidate.roles);
	const roleFit = scoreRoleFit(candidate.roles, creativity);
	const compatibility = scoreCompatibility(candidate.roles);
	const moodCoherence = scoreMoodCoherence(candidate, options);
	const prototype = scorePrototype(candidate.roles);
	const surfaceHierarchy = scoreSurfaceHierarchy(candidate.roles);
	const novelty = scoreNovelty(candidate, creativity);
	const chaos = chaosPenalty(candidate, creativity);
	const boring = boringPenalty(candidate, creativity);
	const generic = genericPenalty(candidate);
	const total = clampScore(
		accessibility * WEIGHTS.accessibility +
			roleFit * WEIGHTS.roleFit +
			compatibility * WEIGHTS.compatibility +
			moodCoherence * WEIGHTS.moodCoherence +
			prototype * WEIGHTS.prototype +
			surfaceHierarchy * WEIGHTS.surfaceHierarchy +
			novelty * WEIGHTS.novelty -
			chaos -
			boring -
			generic,
	);

	return {
		total,
		accessibility,
		roleFit,
		compatibility,
		moodCoherence,
		prototype,
		surfaceHierarchy,
		novelty,
		chaosPenalty: chaos,
		boringPenalty: boring,
		genericPenalty: generic,
		// Backward-compatible aliases for existing UI/tests until the UI labels are updated.
		visualInterest: novelty,
		harmony: compatibility,
		distinctiveness: surfaceHierarchy,
		overSafetyPenalty: boring,
	};
}

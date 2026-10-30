import { hexToOklch, mixColors, normalizeHex } from "./colorMath.js";
import { bestReadableColor, contrastRatio } from "./contrast.js";

function isLoudBackground(color, theme) {
	const profile = hexToOklch(color);
	if (!profile) return true;

	if (theme === "dark") return profile.l > 0.28 || profile.c > 0.12;
	return profile.l < 0.82 || profile.c > 0.12;
}

function deriveCalmBackground(seed, theme) {
	return theme === "dark"
		? mixColors(seed, "#000000", 0.88)
		: mixColors(seed, "#ffffff", 0.92);
}

function ensureReadableText(background, preferredText) {
	const preferred = normalizeHex(preferredText);
	if (preferred && contrastRatio(preferred, background) >= 4.5)
		return preferred;
	return bestReadableColor(background);
}

function ensureReadableMutedText(background, text) {
	for (const amount of [0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05, 0]) {
		const candidate = mixColors(text, background, amount);
		if (contrastRatio(candidate, background) >= 3) return candidate;
	}
	return text;
}

function ensureSurface(background, theme) {
	const surface =
		theme === "dark"
			? mixColors(background, "#ffffff", 0.08)
			: mixColors(background, "#ffffff", 0.78);
	return surface;
}

function ensureBorder(background, text, theme) {
	return mixColors(text, background, theme === "dark" ? 0.72 : 0.84);
}

export function repairUiUsage(candidate) {
	const theme = candidate.theme === "dark" ? "dark" : "light";
	const roles = { ...candidate.roles };
	const notes = [...(candidate.notes ?? [])];
	const creativeColors = (candidate.creativeColors ?? [])
		.map(normalizeHex)
		.filter(Boolean);

	if (
		!normalizeHex(roles.background) ||
		isLoudBackground(roles.background, theme)
	) {
		const backgroundSeed = creativeColors[0] ?? roles.background ?? "#6366f1";
		roles.background = deriveCalmBackground(backgroundSeed, theme);
		notes.push("Derived a calm background from the creative palette.");
	}

	roles.surface = ensureSurface(roles.background, theme);
	roles.surfaceElevated =
		theme === "dark"
			? mixColors(roles.surface, "#ffffff", 0.06)
			: mixColors(roles.surface, "#ffffff", 0.5);

	roles.text = ensureReadableText(roles.background, roles.text);
	if (contrastRatio(roles.text, roles.surface) < 4.5) {
		roles.text = bestReadableColor(roles.surface);
		notes.push("Derived readable text for surface usage.");
	}

	roles.mutedText = ensureReadableMutedText(roles.background, roles.text);
	roles.border = ensureBorder(roles.background, roles.text, theme);

	roles.primary = normalizeHex(roles.primary) ?? creativeColors[0] ?? "#6366f1";
	roles.secondary =
		normalizeHex(roles.secondary) ?? creativeColors[1] ?? roles.primary;
	roles.accent =
		normalizeHex(roles.accent) ?? creativeColors[2] ?? roles.primary;
	roles.primaryHover = normalizeHex(roles.primaryHover) ?? roles.primary;
	roles.onPrimary = bestReadableColor(roles.primary);
	roles.onSecondary = bestReadableColor(roles.secondary);
	roles.onAccent = bestReadableColor(roles.accent);

	return {
		...candidate,
		status: "valid",
		strategy:
			candidate.strategy ?? "creative-palette-with-derived-ui-foundation",
		theme,
		creativeColors,
		roles,
		notes,
	};
}

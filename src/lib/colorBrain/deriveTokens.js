import { adjustLightness, mixColors, normalizeHex } from "./colorMath.js";
import { bestReadableColor } from "./contrast.js";

function fallbackHex(value, fallback) {
	return normalizeHex(value) || fallback;
}

function deriveSurface(background, theme) {
	const target = theme === "dark" ? "#ffffff" : "#ffffff";
	const amount = theme === "dark" ? 0.08 : 0.72;
	return mixColors(background, target, amount);
}

function deriveElevatedSurface(surface, theme) {
	return adjustLightness(surface, theme === "dark" ? 0.04 : 0.015);
}

function deriveMutedText(text, background) {
	return mixColors(text, background, 0.35);
}

export function deriveUiTokens(mapping, options = {}) {
	const theme = options.theme === "dark" ? "dark" : "light";
	const background = fallbackHex(
		mapping.backgroundSeed,
		theme === "dark" ? "#050505" : "#ffffff",
	);
	const text = fallbackHex(mapping.textSeed, bestReadableColor(background));
	const primary = fallbackHex(mapping.primarySeed, "#6366f1");
	const secondary = fallbackHex(mapping.secondarySeed, "#8b5cf6");
	const accent = fallbackHex(mapping.accentSeed, primary);
	const surface = deriveSurface(background, theme);

	return {
		background,
		surface,
		surfaceElevated: deriveElevatedSurface(surface, theme),
		text,
		mutedText: deriveMutedText(text, background),
		border: mixColors(text, background, theme === "dark" ? 0.78 : 0.86),
		primary,
		primaryHover: adjustLightness(primary, theme === "dark" ? 0.06 : -0.06),
		onPrimary: bestReadableColor(primary),
		secondary,
		onSecondary: bestReadableColor(secondary),
		accent,
		onAccent: bestReadableColor(accent),
	};
}

export function toLegacyPalette(colorBrainPalette) {
	const roles = colorBrainPalette.roles;

	return {
		name:
			colorBrainPalette.name ?? colorBrainPalette.id ?? "colorBrain palette",
		primary: roles.background,
		secondary: roles.surface,
		accent: roles.accent,
		text: roles.text,
		textMuted: roles.mutedText,
		onAccent: roles.onAccent,
		_colorBrain: colorBrainPalette,
	};
}

import { expect } from "vitest";

export const HEX_RE = /^#[0-9a-f]{6}$/i;

export async function loadModule(path) {
	try {
		return await import(path);
	} catch (error) {
		throw new Error(
			`Expected colorBrain module ${path} to exist and be importable. Original error: ${error.message}`,
		);
	}
}

export function expectHex(value) {
	expect(value).toMatch(HEX_RE);
}

export function expectLegacyPaletteShape(palette) {
	expect(palette).toEqual(
		expect.objectContaining({
			name: expect.any(String),
			primary: expect.any(String),
			secondary: expect.any(String),
			accent: expect.any(String),
			text: expect.any(String),
			textMuted: expect.any(String),
			onAccent: expect.any(String),
		}),
	);

	["primary", "secondary", "accent", "text", "textMuted", "onAccent"].forEach(
		(key) => expectHex(palette[key]),
	);
}

export function expectRichPaletteShape(palette) {
	expect(palette).toEqual(
		expect.objectContaining({
			id: expect.any(String),
			status: "valid",
			creativeColors: expect.any(Array),
			roles: expect.any(Object),
			score: expect.any(Object),
		}),
	);

	expect(palette.creativeColors.length).toBeGreaterThanOrEqual(3);
	palette.creativeColors.forEach(expectHex);

	["background", "surface", "text", "mutedText", "accent", "onAccent"].forEach(
		(role) => expectHex(palette.roles[role]),
	);
}

export function expectMinimumUiContrast(contrast, roles) {
	expect(
		contrast.contrastRatio(roles.text, roles.background),
	).toBeGreaterThanOrEqual(4.5);
	expect(
		contrast.contrastRatio(roles.text, roles.surface),
	).toBeGreaterThanOrEqual(4.5);
	expect(
		contrast.contrastRatio(roles.onAccent, roles.accent),
	).toBeGreaterThanOrEqual(4.5);

	if (roles.mutedText) {
		expect(
			contrast.contrastRatio(roles.mutedText, roles.background),
		).toBeGreaterThanOrEqual(3);
	}
}

export function originalColorWasPreserved(originalColors, roles) {
	const roleValues = new Set(
		Object.values(roles).map((value) => value.toLowerCase()),
	);
	return originalColors.some((color) => roleValues.has(color.toLowerCase()));
}

import { beforeAll, describe, expect, it } from "vitest";
import { expectHex, loadModule } from "./testUtils.js";

let colorMath;

beforeAll(async () => {
	colorMath = await loadModule("../colorMath.js");
});

describe("colorBrain perceptual color math", () => {
	it("normalizes valid hex colors and rejects invalid input", () => {
		expect(colorMath.normalizeHex("6366f1")).toBe("#6366f1");
		expect(colorMath.normalizeHex("#ABCDEF")).toBe("#abcdef");
		expect(colorMath.normalizeHex("#abc")).toBe(null);
		expect(colorMath.normalizeHex("not-a-color")).toBe(null);
	});

	it("round-trips hex through OKLCH without leaving displayable hex space", () => {
		["#6366f1", "#d4ff00", "#050505", "#ffffff"].forEach((hex) => {
			const oklch = colorMath.hexToOklch(hex);
			expect(oklch).toEqual(
				expect.objectContaining({
					l: expect.any(Number),
					c: expect.any(Number),
				}),
			);
			expect(oklch.l).toBeGreaterThanOrEqual(0);
			expect(oklch.l).toBeLessThanOrEqual(1);
			expect(oklch.c).toBeGreaterThanOrEqual(0);
			expectHex(colorMath.oklchToHex(oklch));
		});
	});

	it("can make colors lighter, darker, calmer, and more expressive", () => {
		const base = "#6366f1";
		const baseProfile = colorMath.hexToOklch(base);
		const lighter = colorMath.adjustLightness(base, 0.12);
		const darker = colorMath.adjustLightness(base, -0.12);
		const calmer = colorMath.adjustChroma(base, 0.5);
		const expressive = colorMath.adjustChroma(base, 1.2);

		[lighter, darker, calmer, expressive].forEach(expectHex);
		expect(colorMath.hexToOklch(lighter).l).toBeGreaterThan(baseProfile.l);
		expect(colorMath.hexToOklch(darker).l).toBeLessThan(baseProfile.l);
		expect(colorMath.hexToOklch(calmer).c).toBeLessThan(baseProfile.c);
		expect(colorMath.hexToOklch(expressive).c).toBeGreaterThanOrEqual(
			baseProfile.c * 0.95,
		);
	});

	it("rotates hue while preserving usable lightness and chroma", () => {
		const base = colorMath.hexToOklch("#6366f1");
		const rotatedHex = colorMath.rotateHue("#6366f1", 120);
		const rotated = colorMath.hexToOklch(rotatedHex);

		expectHex(rotatedHex);
		expect(Math.abs(rotated.l - base.l)).toBeLessThan(0.1);
		expect(rotated.c).toBeGreaterThan(0.01);
	});

	it("mixes two colors into a displayable result", () => {
		expectHex(colorMath.mixColors("#ff0000", "#0000ff", 0.5));
		expect(colorMath.mixColors("#ffffff", "#000000", 0)).toBe("#ffffff");
		expect(colorMath.mixColors("#ffffff", "#000000", 1)).toBe("#000000");
	});
});

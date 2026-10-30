import { clampRgb, converter, formatHex, interpolate } from "culori";

const HEX_COLOR_RE = /^#?([0-9a-fA-F]{6})$/;
const toOklch = converter("oklch");

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

export function normalizeHex(input) {
	if (typeof input !== "string") return null;

	const match = input.trim().match(HEX_COLOR_RE);
	if (!match) return null;

	return `#${match[1].toLowerCase()}`;
}

export function hexToOklch(hex) {
	const normalized = normalizeHex(hex);
	if (!normalized) return null;

	const color = toOklch(normalized);
	if (!color) return null;

	return {
		l: clamp(color.l ?? 0, 0, 1),
		c: Math.max(0, color.c ?? 0),
		h: Number.isFinite(color.h) ? color.h : 0,
	};
}

export function oklchToHex(color) {
	if (!color) return "#000000";

	return formatHex(
		clampRgb({
			mode: "oklch",
			l: clamp(color.l ?? 0, 0, 1),
			c: Math.max(0, color.c ?? 0),
			h: Number.isFinite(color.h) ? color.h : 0,
		}),
	);
}

export function clampToDisplayable(hex) {
	const color = hexToOklch(hex);
	return color ? oklchToHex(color) : "#000000";
}

export function mixColors(from, to, amount) {
	const normalizedFrom = normalizeHex(from);
	const normalizedTo = normalizeHex(to);
	if (!normalizedFrom || !normalizedTo) return "#000000";

	const clampedAmount = clamp(amount, 0, 1);
	if (clampedAmount === 0) return normalizedFrom;
	if (clampedAmount === 1) return normalizedTo;

	return formatHex(
		interpolate([normalizedFrom, normalizedTo], "oklch")(clampedAmount),
	);
}

export function adjustLightness(hex, delta) {
	const color = hexToOklch(hex);
	if (!color) return "#000000";

	return oklchToHex({
		...color,
		l: clamp(color.l + delta, 0, 1),
	});
}

export function adjustChroma(hex, multiplier) {
	const color = hexToOklch(hex);
	if (!color) return "#000000";

	return oklchToHex({
		...color,
		c: Math.max(0, color.c * multiplier),
	});
}

export function rotateHue(hex, degrees) {
	const color = hexToOklch(hex);
	if (!color) return "#000000";

	return oklchToHex({
		...color,
		h: (((color.h + degrees) % 360) + 360) % 360,
	});
}

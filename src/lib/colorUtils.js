export function clampColorChannel(value) {
	return Math.max(0, Math.min(255, Math.round(value)));
}

export function hexToRgbColor(hex) {
	const normalized = String(hex || "").replace("#", "");
	if (normalized.length !== 6) return null;
	return {
		r: Number.parseInt(normalized.slice(0, 2), 16),
		g: Number.parseInt(normalized.slice(2, 4), 16),
		b: Number.parseInt(normalized.slice(4, 6), 16),
	};
}

export function rgbToHexColor({ r, g, b }) {
	return [r, g, b]
		.map((channel) => clampColorChannel(channel).toString(16).padStart(2, "0"))
		.join("")
		.replace(/^/, "#");
}

export function mixHexColors(leftHex, rightHex, amount = 0.5) {
	const left = hexToRgbColor(leftHex);
	const right = hexToRgbColor(rightHex);
	if (!left || !right) return leftHex || rightHex || "#888888";
	return rgbToHexColor({
		r: left.r + (right.r - left.r) * amount,
		g: left.g + (right.g - left.g) * amount,
		b: left.b + (right.b - left.b) * amount,
	});
}

export function rgbToHslColor({ r, g, b }) {
	const red = r / 255;
	const green = g / 255;
	const blue = b / 255;
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const lightness = (max + min) / 2;
	const delta = max - min;

	if (delta === 0) {
		return { h: 0, s: 0, l: lightness };
	}

	const saturation =
		lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
	let hue;
	if (max === red) {
		hue = (green - blue) / delta + (green < blue ? 6 : 0);
	} else if (max === green) {
		hue = (blue - red) / delta + 2;
	} else {
		hue = (red - green) / delta + 4;
	}

	return { h: hue * 60, s: saturation, l: lightness };
}

function hueToRgb(p, q, t) {
	let value = t;
	if (value < 0) value += 1;
	if (value > 1) value -= 1;
	if (value < 1 / 6) return p + (q - p) * 6 * value;
	if (value < 1 / 2) return q;
	if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
	return p;
}

export function hslToRgbColor({ h, s, l }) {
	const hue = (((h % 360) + 360) % 360) / 360;
	if (s === 0) {
		const channel = l * 255;
		return { r: channel, g: channel, b: channel };
	}
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	return {
		r: hueToRgb(p, q, hue + 1 / 3) * 255,
		g: hueToRgb(p, q, hue) * 255,
		b: hueToRgb(p, q, hue - 1 / 3) * 255,
	};
}

export function shiftHexHue(
	hex,
	degrees,
	{ minSaturation = 0.45, lightness } = {},
) {
	const rgb = hexToRgbColor(hex);
	if (!rgb) return "#888888";
	const hsl = rgbToHslColor(rgb);
	return rgbToHexColor(
		hslToRgbColor({
			h: hsl.h + degrees,
			s: Math.max(hsl.s, minSaturation),
			l: typeof lightness === "number" ? lightness : hsl.l,
		}),
	);
}

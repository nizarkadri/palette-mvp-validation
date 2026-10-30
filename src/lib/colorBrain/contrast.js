const HEX_COLOR_RE = /^#?([0-9a-fA-F]{6})$/;

export function hexToRgb(hex) {
	if (typeof hex !== "string") return null;

	const match = hex.trim().match(HEX_COLOR_RE);
	if (!match) return null;

	const value = match[1];
	return {
		r: parseInt(value.slice(0, 2), 16),
		g: parseInt(value.slice(2, 4), 16),
		b: parseInt(value.slice(4, 6), 16),
	};
}

export function relativeLuminance(hex) {
	const rgb = hexToRgb(hex);
	if (!rgb) return 0;

	const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((channel) => {
		const value = channel / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});

	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground, background) {
	const foregroundLuminance = relativeLuminance(foreground);
	const backgroundLuminance = relativeLuminance(background);
	const lighter = Math.max(foregroundLuminance, backgroundLuminance);
	const darker = Math.min(foregroundLuminance, backgroundLuminance);

	return (lighter + 0.05) / (darker + 0.05);
}

export function passesNormalText(foreground, background) {
	return contrastRatio(foreground, background) >= 4.5;
}

export function passesLargeText(foreground, background) {
	return contrastRatio(foreground, background) >= 3;
}

export function bestReadableColor(
	background,
	candidates = ["#ffffff", "#000000"],
) {
	return candidates
		.map((candidate) => ({
			color: candidate.toLowerCase(),
			ratio: contrastRatio(candidate, background),
		}))
		.sort((a, b) => b.ratio - a.ratio)[0].color;
}

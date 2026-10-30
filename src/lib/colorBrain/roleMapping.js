import { hexToOklch, normalizeHex } from "./colorMath.js";

function profileColor(color) {
	const hex = normalizeHex(color);
	const oklch = hexToOklch(hex);
	return {
		hex,
		l: oklch?.l ?? 0,
		c: oklch?.c ?? 0,
		h: oklch?.h ?? 0,
	};
}

function mappingKey(mapping) {
	return [
		mapping.backgroundSeed,
		mapping.textSeed,
		mapping.primarySeed,
		mapping.secondarySeed,
		mapping.accentSeed,
	]
		.map((color) => color.toLowerCase())
		.join("|");
}

function dedupeMappings(mappings) {
	const seen = new Set();
	const result = [];

	mappings.forEach((mapping) => {
		const key = mappingKey(mapping);
		if (seen.has(key)) return;
		seen.add(key);
		result.push(mapping);
	});

	return result;
}

function createMapping([
	backgroundSeed,
	textSeed,
	primarySeed,
	secondarySeed,
	accentSeed,
]) {
	return {
		backgroundSeed,
		textSeed,
		primarySeed,
		secondarySeed,
		accentSeed,
	};
}

function permutations(items) {
	if (items.length <= 1) return [items];
	return items.flatMap((item, index) => {
		const rest = [...items.slice(0, index), ...items.slice(index + 1)];
		return permutations(rest).map((permutation) => [item, ...permutation]);
	});
}

function createHeuristicMappings(profiles, theme) {
	const byLightness = [...profiles].sort((a, b) => a.l - b.l);
	const byChroma = [...profiles].sort((a, b) => b.c - a.c);
	const lowChroma = [...profiles].sort((a, b) => a.c - b.c);
	const mediumColorful = [...profiles].sort((a, b) => {
		const aScore = Math.abs(a.l - 0.58) - a.c;
		const bScore = Math.abs(b.l - 0.58) - b.c;
		return aScore - bScore;
	});

	const background = theme === "dark" ? byLightness[0] : byLightness.at(-1);
	const text = theme === "dark" ? byLightness.at(-1) : byLightness[0];
	const primary =
		mediumColorful.find(
			(color) => color.hex !== background.hex && color.hex !== text.hex,
		) ?? byChroma[0];
	const accent =
		byChroma.find((color) => color.hex !== primary.hex) ?? byChroma[0];
	const secondary =
		lowChroma.find(
			(color) =>
				![background.hex, text.hex, primary.hex, accent.hex].includes(
					color.hex,
				),
		) ??
		profiles.find((color) => color.hex !== background.hex) ??
		profiles[0];

	const candidates = [
		[background, text, primary, secondary, accent],
		[background, text, accent, secondary, primary],
		[background, text, primary, accent, secondary],
		[background, text, secondary, primary, accent],
	];

	return candidates.map((candidate) =>
		createMapping(candidate.map((color) => color.hex)),
	);
}

export function createRoleMappingCandidates(creativeColors, options = {}) {
	const profiles = creativeColors
		.map(profileColor)
		.filter((profile) => profile.hex);

	if (profiles.length === 0) return [];

	const theme = options.theme === "dark" ? "dark" : "light";
	const hexColors = profiles.map((profile) => profile.hex);
	const permutationMappings = permutations(hexColors).map(createMapping);
	const heuristicMappings = createHeuristicMappings(profiles, theme);

	return dedupeMappings([...heuristicMappings, ...permutationMappings]);
}

import {
	clampCount,
	normalizeCreativeColors,
	normalizeLockedColors,
	fetchJsonWithTimeout,
} from "./utils.js";

const HUEMINT_API_URL = "https://api.huemint.com/color";
const DEFAULT_NUM_COLORS = 5;

function createAdjacencyMatrix(numColors) {
	return Array.from({ length: numColors * numColors }, (_, index) => {
		const row = Math.floor(index / numColors);
		const col = index % numColors;
		if (row === col) return "0";
		if (row === 0 && col === 1) return "85";
		if (row === 1 && col === 0) return "85";
		if (row === 0 || col === 0) return "45";
		return "55";
	});
}

function createLockedPalette(lockedColors, numColors) {
	return Array.from(
		{ length: numColors },
		(_, index) => lockedColors[index] ?? "-",
	);
}

function normalizeHuemintResults(results) {
	if (!Array.isArray(results)) return [];
	return results
		.map((result, index) => {
			const creativeColors = normalizeCreativeColors(result.palette ?? []);
			if (creativeColors.length === 0) return null;
			return {
				id: `huemint-${index}`,
				source: "huemint",
				strategy: "transformer",
				creativeColors,
				raw: result,
			};
		})
		.filter(Boolean);
}

export async function fetchHuemintAnchors(options = {}, fetchImpl) {
	const count = clampCount(options.count);
	const lockedColors = normalizeLockedColors(options.lockedColors);
	const numColors = Math.max(
		DEFAULT_NUM_COLORS,
		Math.min(12, lockedColors.length || DEFAULT_NUM_COLORS),
	);
	const data = await fetchJsonWithTimeout(
		HUEMINT_API_URL,
		{
			method: "POST",
			headers: { "Content-Type": "application/json; charset=utf-8" },
			body: JSON.stringify({
				mode: "transformer",
				num_colors: numColors,
				temperature: options.creativity === "wild" ? "1.7" : "1.2",
				num_results: Math.min(50, count),
				adjacency: createAdjacencyMatrix(numColors),
				palette: createLockedPalette(lockedColors, numColors),
			}),
		},
		fetchImpl,
	);

	return normalizeHuemintResults(data.results).slice(0, count);
}

export const huemintInternals = {
	createAdjacencyMatrix,
	createLockedPalette,
	normalizeHuemintResults,
};

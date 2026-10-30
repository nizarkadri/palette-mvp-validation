import {
	clampCount,
	hexToRgbArray,
	normalizeCreativeColors,
	normalizeLockedColors,
	rgbArrayToHex,
	fetchJsonWithTimeout,
} from "./utils.js";

const COLORMIND_API_URL = "http://colormind.io/api/";

function createColormindInput(lockedColors) {
	const rgbLocks = lockedColors.map(hexToRgbArray).filter(Boolean).slice(0, 5);
	return Array.from({ length: 5 }, (_, index) => rgbLocks[index] ?? "N");
}

function normalizeColormindResult(result) {
	if (!Array.isArray(result)) return [];
	return normalizeCreativeColors(result.map(rgbArrayToHex));
}

export async function fetchColormindAnchors(options = {}, fetchImpl) {
	const count = clampCount(options.count);
	const lockedColors = normalizeLockedColors(options.lockedColors);
	const requestCount = Math.min(count, 12);
	const requests = Array.from({ length: requestCount }, async (_, index) => {
		const body = {
			model: "ui",
		};

		if (lockedColors.length > 0) {
			body.input = createColormindInput(lockedColors);
		}

		const data = await fetchJsonWithTimeout(
			COLORMIND_API_URL,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			fetchImpl,
		);
		const creativeColors = normalizeColormindResult(data.result);
		if (creativeColors.length === 0) return null;

		return {
			id: `colormind-${index}`,
			source: "colormind",
			strategy: "ui-model",
			creativeColors,
			raw: data,
		};
	});

	return (await Promise.all(requests)).filter(Boolean).slice(0, count);
}

export const colormindInternals = {
	createColormindInput,
	normalizeColormindResult,
};

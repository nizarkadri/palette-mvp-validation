import { normalizeHex } from "../../../src/lib/colorBrain/colorMath.js";
import {
	clampCount,
	normalizeCreativeColors,
	normalizeLockedColors,
	fetchJsonWithTimeout,
} from "./utils.js";

const THE_COLOR_API_URL = "https://www.thecolorapi.com/scheme";
const DEFAULT_SEED_COLOR = "#6366f1";
const MODES = [
	"triad",
	"quad",
	"analogic",
	"complement",
	"analogic-complement",
	"monochrome",
];

function cleanHex(hex) {
	return normalizeHex(hex)?.replace("#", "") ?? null;
}

function extractSchemeColors(data) {
	return normalizeCreativeColors(
		(data.colors ?? []).map((color) => color?.hex?.value ?? color?.hex?.clean),
	);
}

function buildSchemeUrl({ seedColor, mode, count }) {
	const url = new URL(THE_COLOR_API_URL);
	url.searchParams.set(
		"hex",
		cleanHex(seedColor) ?? cleanHex(DEFAULT_SEED_COLOR),
	);
	url.searchParams.set("mode", mode);
	url.searchParams.set("count", String(Math.max(3, Math.min(8, count))));
	return url.toString();
}

export async function fetchTheColorApiAnchors(options = {}, fetchImpl) {
	const count = clampCount(options.count);
	const lockedColors = normalizeLockedColors(options.lockedColors);
	const seedColor =
		normalizeHex(options.seedColor) ?? lockedColors[0] ?? DEFAULT_SEED_COLOR;
	const requests = MODES.slice(0, Math.min(MODES.length, count)).map(
		async (mode, index) => {
			const data = await fetchJsonWithTimeout(
				buildSchemeUrl({ seedColor, mode, count: 5 }),
				{ method: "GET" },
				fetchImpl,
			);
			const creativeColors = extractSchemeColors(data);
			if (creativeColors.length === 0) return null;
			return {
				id: `the-color-api-${mode}-${index}`,
				source: "the-color-api",
				strategy: mode,
				creativeColors,
				raw: data,
			};
		},
	);

	return (await Promise.all(requests)).filter(Boolean).slice(0, count);
}

export const theColorApiInternals = {
	buildSchemeUrl,
	extractSchemeColors,
};

import { generateAnchorPalettes } from "../../../src/lib/colorBrain/anchors.js";
import { normalizeHex } from "../../../src/lib/colorBrain/colorMath.js";
import { hexToRgb } from "../../../src/lib/colorBrain/contrast.js";

export const DEFAULT_ANCHOR_COUNT = 12;
export const MAX_ANCHOR_COUNT = 50;
export const DEFAULT_ANCHOR_SIZE = 5;
export const FETCH_TIMEOUT_MS = 5000;

export function clampCount(count, fallback = DEFAULT_ANCHOR_COUNT) {
	const numeric = Number(count);
	if (!Number.isFinite(numeric)) return fallback;
	return Math.max(1, Math.min(MAX_ANCHOR_COUNT, Math.floor(numeric)));
}

export function normalizeLockedColors(lockedColors = []) {
	return Array.isArray(lockedColors)
		? lockedColors.map(normalizeHex).filter(Boolean)
		: [];
}

export function hexToRgbArray(hex) {
	const rgb = hexToRgb(hex);
	return rgb ? [rgb.r, rgb.g, rgb.b] : null;
}

export function rgbArrayToHex(rgb) {
	if (!Array.isArray(rgb) || rgb.length < 3) return null;
	const channels = rgb.slice(0, 3).map((channel) => {
		const value = Math.max(0, Math.min(255, Math.round(Number(channel))));
		return value.toString(16).padStart(2, "0");
	});
	return normalizeHex(`#${channels.join("")}`);
}

export function normalizeCreativeColors(colors = []) {
	const normalized = colors.map(normalizeHex).filter(Boolean);
	return normalized.length >= 3 ? normalized : [];
}

export function createLocalFallbackAnchors({
	count,
	seedColor,
	lockedColors,
	creativity,
	randomSeed = "server-fallback",
} = {}) {
	return generateAnchorPalettes({
		count: clampCount(count),
		seedColor,
		lockedColors,
		creativity,
		randomSeed,
	}).map((palette) => ({
		...palette,
		source: "local-fallback",
	}));
}

export async function fetchJsonWithTimeout(
	url,
	options = {},
	fetchImpl = globalThis.fetch,
) {
	if (typeof fetchImpl !== "function") {
		throw new Error("Fetch is not available in this runtime.");
	}

	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		options.timeoutMs ?? FETCH_TIMEOUT_MS,
	);

	try {
		const response = await fetchImpl(url, {
			...options,
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`Request failed with status ${response.status}.`);
		}
		return await response.json();
	} finally {
		clearTimeout(timeout);
	}
}

import { readJsonBody, sendJson } from "../utils/stream.js";
import { fetchColormindAnchors } from "../services/colorSources/colormind.js";
import { fetchHuemintAnchors } from "../services/colorSources/huemint.js";
import { fetchTheColorApiAnchors } from "../services/colorSources/theColorApi.js";
import {
	clampCount,
	createLocalFallbackAnchors,
} from "../services/colorSources/utils.js";

const VALID_SOURCES = new Set([
	"mixed",
	"huemint",
	"colormind",
	"the-color-api",
]);

const SOURCE_FETCHERS = {
	huemint: fetchHuemintAnchors,
	colormind: fetchColormindAnchors,
	"the-color-api": fetchTheColorApiAnchors,
};

function normalizeSource(source) {
	return typeof source === "string" && VALID_SOURCES.has(source)
		? source
		: "mixed";
}

async function fetchFromSource(source, options, fetchImpl) {
	const fetcher = SOURCE_FETCHERS[source];
	if (!fetcher) return [];
	return fetcher(options, fetchImpl);
}

function createFallback(options, reason) {
	return {
		anchorPalettes: createLocalFallbackAnchors({
			...options,
			randomSeed: `server-fallback-${options.source}-${options.count}`,
		}),
		diagnostics: {
			fallbackUsed: true,
			reason,
			sourcesTried:
				options.source === "mixed"
					? Object.keys(SOURCE_FETCHERS)
					: [options.source],
		},
	};
}

export async function getColorBrainAnchorPalettes(request = {}, fetchImpl) {
	const source = normalizeSource(request.source);
	const count = clampCount(request.count);
	const options = {
		...request,
		source,
		count,
	};

	if (source === "mixed") {
		const results = await Promise.allSettled(
			Object.entries(SOURCE_FETCHERS).map(async ([sourceName, fetcher]) => ({
				source: sourceName,
				anchorPalettes: await fetcher(options, fetchImpl),
			})),
		);
		const anchorPalettes = results
			.filter((result) => result.status === "fulfilled")
			.flatMap((result) => result.value.anchorPalettes)
			.slice(0, count);

		if (anchorPalettes.length > 0) {
			return {
				anchorPalettes,
				diagnostics: {
					fallbackUsed: false,
					sourcesTried: Object.keys(SOURCE_FETCHERS),
					failures: results.filter((result) => result.status === "rejected")
						.length,
				},
			};
		}

		return createFallback(
			options,
			"All external color sources failed or returned no anchors.",
		);
	}

	try {
		const anchorPalettes = await fetchFromSource(source, options, fetchImpl);
		if (anchorPalettes.length > 0) {
			return {
				anchorPalettes: anchorPalettes.slice(0, count),
				diagnostics: {
					fallbackUsed: false,
					sourcesTried: [source],
				},
			};
		}
	} catch (error) {
		return createFallback(options, error.message || `${source} failed.`);
	}

	return createFallback(options, `${source} returned no anchors.`);
}

export function createColorBrainRoute() {
	return async function colorBrainRoute(req, res) {
		if (req.method !== "POST") {
			res.setHeader("Allow", "POST");
			sendJson(res, 405, { error: "Method not allowed." });
			return;
		}

		try {
			const body = await readJsonBody(req);
			if (body.source && !VALID_SOURCES.has(body.source)) {
				sendJson(res, 400, {
					error: "Unsupported color source.",
					allowedSources: [...VALID_SOURCES],
				});
				return;
			}

			const result = await getColorBrainAnchorPalettes(body, globalThis.fetch);
			sendJson(res, 200, result);
		} catch (error) {
			sendJson(res, 500, {
				error: error.message || "ColorBrain anchor generation failed.",
			});
		}
	};
}

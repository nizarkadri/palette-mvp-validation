import { hexToOklch } from "./colorMath.js";
import { contrastRatio } from "./contrast.js";
import { deriveUiTokens, toLegacyPalette } from "./deriveTokens.js";
import { repairUiUsage } from "./repair.js";
import { generateRecipeThemeCandidates } from "./recipes.js";
import { createRoleMappingCandidates } from "./roleMapping.js";
import { scoreUiTheme } from "./score.js";
import {
	DEFAULT_COLORBRAIN_OPTIONS,
	normalizeCreativityMode,
	normalizeThemeMode,
} from "./types.js";

function resolveTheme(theme, index) {
	if (theme === "light" || theme === "dark") return theme;
	return index % 2 === 0 ? "light" : "dark";
}

function ensureAnchorPalettes(options) {
	if (
		Array.isArray(options.anchorPalettes) &&
		options.anchorPalettes.length > 0
	) {
		return options.anchorPalettes;
	}

	return [];
}

function buildAnchorCandidates(anchorPalette, options, anchorIndex) {
	const theme = resolveTheme(options.theme, anchorIndex);
	const mappings = createRoleMappingCandidates(anchorPalette.creativeColors, {
		theme,
		creativity: options.creativity,
	});

	return mappings.map((mapping, mappingIndex) => {
		const roles = deriveUiTokens(mapping, {
			theme,
			creativity: options.creativity,
			creativeColors: anchorPalette.creativeColors,
		});
		const repaired = repairUiUsage({
			id: `${anchorPalette.id}-${mappingIndex}`,
			name: `colorBrain ${anchorIndex + 1}.${mappingIndex + 1}`,
			anchorId: anchorPalette.id,
			creativeColors: anchorPalette.creativeColors,
			source: anchorPalette.source,
			strategy: anchorPalette.strategy,
			creativity: options.creativity,
			theme,
			mapping,
			roles,
		});
		const score = scoreUiTheme(repaired, { creativity: options.creativity });

		return {
			...repaired,
			score,
		};
	});
}

function buildRecipeCandidates(options, count) {
	return generateRecipeThemeCandidates({
		...options,
		count: Math.max(count, 40),
	}).map((candidate) => {
		const repaired = repairUiUsage(candidate);
		const score = scoreUiTheme(repaired, {
			creativity: options.creativity,
			recipe: candidate.recipe,
		});

		return {
			...repaired,
			score,
		};
	});
}

function hueBucket(color, size = 18) {
	const hue = hexToOklch(color)?.h ?? 0;
	return Math.round(hue / size) * size;
}

function lightnessBucket(color, size = 0.05) {
	const lightness = hexToOklch(color)?.l ?? 0;
	return Math.round(lightness / size) * size;
}

function chromaBucket(color, size = 0.04) {
	const chroma = hexToOklch(color)?.c ?? 0;
	return Math.round(chroma / size) * size;
}

function createPaletteFingerprint(candidate) {
	const roles = candidate.roles;
	return [
		candidate.theme ?? "auto",
		candidate.recipe ?? candidate.strategy ?? "anchor",
		`accent-${hueBucket(roles.accent)}`,
		`accent-c-${chromaBucket(roles.accent).toFixed(2)}`,
		`bg-l-${lightnessBucket(roles.background).toFixed(2)}`,
		`bg-h-${hueBucket(roles.background, 30)}`,
		`text-l-${lightnessBucket(roles.text).toFixed(2)}`,
	].join("|");
}

function oklchDistance(a, b) {
	const first = hexToOklch(a);
	const second = hexToOklch(b);
	if (!first || !second) return Number.POSITIVE_INFINITY;
	const hueDiff =
		Math.min(
			Math.abs(first.h - second.h) % 360,
			360 - (Math.abs(first.h - second.h) % 360),
		) / 360;
	return Math.sqrt(
		(first.l - second.l) ** 2 + (first.c - second.c) ** 2 + hueDiff ** 2,
	);
}

function areTooSimilar(a, b) {
	if (a.dedupe?.fingerprint === b.dedupe?.fingerprint) return true;

	const accentHueDistance = Math.min(
		Math.abs(
			(hexToOklch(a.roles.accent)?.h ?? 0) -
				(hexToOklch(b.roles.accent)?.h ?? 0),
		) % 360,
		360 -
			(Math.abs(
				(hexToOklch(a.roles.accent)?.h ?? 0) -
					(hexToOklch(b.roles.accent)?.h ?? 0),
			) %
				360),
	);
	const backgroundDistance = oklchDistance(
		a.roles.background,
		b.roles.background,
	);
	const textDistance = oklchDistance(a.roles.text, b.roles.text);
	const accentDistance = oklchDistance(a.roles.accent, b.roles.accent);

	return (
		accentHueDistance < 10 &&
		backgroundDistance < 0.035 &&
		textDistance < 0.045 &&
		accentDistance < 0.06
	);
}

function passesHardGates(candidate) {
	const roles = candidate.roles;
	const highChromaVisible = [
		roles.background,
		roles.surface,
		roles.accent,
		roles.text,
		roles.mutedText,
	]
		.map(hexToOklch)
		.filter(Boolean)
		.filter((color) => color.c > 0.16).length;

	return (
		contrastRatio(roles.text, roles.background) >= 4.5 &&
		contrastRatio(roles.text, roles.surface) >= 4.5 &&
		contrastRatio(roles.onAccent, roles.accent) >= 4.5 &&
		contrastRatio(roles.mutedText, roles.background) >= 3 &&
		highChromaVisible <= 2
	);
}

function rankAndDedupe(candidates) {
	const sorted = [...candidates].sort((a, b) => b.score.total - a.score.total);
	const ranked = [];
	let hardGateRejected = 0;
	let similarRejected = 0;

	for (const candidate of sorted) {
		if (!passesHardGates(candidate)) {
			hardGateRejected += 1;
			continue;
		}

		const enriched = {
			...candidate,
			dedupe: {
				fingerprint: createPaletteFingerprint(candidate),
				similarRecentCount: 0,
			},
		};
		const similarRecentCount = ranked.filter((palette) =>
			areTooSimilar(enriched, palette),
		).length;

		if (similarRecentCount > 0) {
			similarRejected += 1;
			continue;
		}

		ranked.push({
			...enriched,
			dedupe: {
				...enriched.dedupe,
				similarRecentCount,
			},
		});
	}

	return {
		ranked: ranked.length > 0 ? ranked : sorted,
		hardGateRejected,
		similarRejected,
	};
}

function normalizeMaxPalettesPerAnchor(value) {
	if (!Number.isFinite(value)) return 5;
	return Math.max(1, Math.floor(value));
}

function fillRankedToTarget(ranked, candidates, target) {
	if (ranked.length >= target) return ranked;

	const selectedIds = new Set(ranked.map((palette) => palette.id));
	const filled = [...ranked];
	const sorted = [...candidates].sort((a, b) => b.score.total - a.score.total);

	for (const candidate of sorted) {
		if (filled.length >= target) break;
		if (selectedIds.has(candidate.id)) continue;
		selectedIds.add(candidate.id);
		filled.push({
			...candidate,
			dedupe: candidate.dedupe ?? {
				fingerprint: createPaletteFingerprint(candidate),
				similarRecentCount: 0,
			},
		});
	}

	return filled;
}

function buildCappedAnchorCandidates(anchors, options, maxPalettesPerAnchor) {
	let mappingCandidates = 0;
	let hardGateRejected = 0;
	let similarRejected = 0;
	const cappedCandidates = anchors.flatMap((anchorPalette, anchorIndex) => {
		const candidates = buildAnchorCandidates(
			anchorPalette,
			options,
			anchorIndex,
		);
		mappingCandidates += candidates.length;
		const deduped = rankAndDedupe(candidates);
		hardGateRejected += deduped.hardGateRejected;
		similarRejected += deduped.similarRejected;
		return fillRankedToTarget(
			deduped.ranked,
			candidates,
			maxPalettesPerAnchor,
		).slice(0, maxPalettesPerAnchor);
	});

	return {
		candidates: cappedCandidates,
		mappingCandidates,
		hardGateRejected,
		similarRejected,
	};
}

export function generateColorBrainPalettes(input = {}) {
	const count = Math.max(0, input.count ?? DEFAULT_COLORBRAIN_OPTIONS.count);
	const creativity = normalizeCreativityMode(input.creativity);
	const theme = normalizeThemeMode(input.theme);
	const options = {
		...input,
		creativity,
		theme,
		randomSeed: input.randomSeed ?? DEFAULT_COLORBRAIN_OPTIONS.randomSeed,
	};
	const anchors = ensureAnchorPalettes(options);
	const maxPalettesPerAnchor = normalizeMaxPalettesPerAnchor(
		input.maxPalettesPerAnchor,
	);
	const anchorCandidateResult =
		anchors.length > 0
			? buildCappedAnchorCandidates(anchors, options, maxPalettesPerAnchor)
			: null;
	const candidates = anchorCandidateResult
		? anchorCandidateResult.candidates
		: buildRecipeCandidates(options, count);
	const deduped = rankAndDedupe(candidates);
	const targetCount = Math.min(count, candidates.length);
	let ranked = anchorCandidateResult
		? fillRankedToTarget(deduped.ranked, candidates, targetCount)
		: deduped.ranked;

	while (!anchorCandidateResult && ranked.length < count && ranked.length > 0) {
		ranked = [...ranked, ...ranked.map((palette) => ({ ...palette }))];
	}

	const palettes = ranked.slice(0, count).map((palette, index) => ({
		...palette,
		dedupe: palette.dedupe ?? {
			fingerprint: createPaletteFingerprint(palette),
			similarRecentCount: 0,
		},
		id: `colorBrain-${options.randomSeed}-${index}`,
		name: `colorBrain ${index + 1}`,
	}));

	return {
		palettes,
		legacyPalettes: palettes.map(toLegacyPalette),
		diagnostics: {
			generatedAnchors: anchors.length,
			generatedRecipes: anchors.length > 0 ? 0 : candidates.length,
			mappingCandidates:
				anchorCandidateResult?.mappingCandidates ?? candidates.length,
			repairedCandidates:
				anchorCandidateResult?.mappingCandidates ?? candidates.length,
			hardGateRejected:
				(anchorCandidateResult?.hardGateRejected ?? 0) +
				deduped.hardGateRejected,
			similarRejected:
				(anchorCandidateResult?.similarRejected ?? 0) + deduped.similarRejected,
			maxPalettesPerAnchor: anchors.length > 0 ? maxPalettesPerAnchor : null,
			returned: palettes.length,
		},
	};
}

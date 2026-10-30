import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import UploadZone from "./components/UploadZone.jsx";
import UiPreview from "./components/UiPreview.jsx";
import VariantPicker from "./components/VariantPicker.jsx";
import RoleKanban from "./components/RoleKanban.jsx";
import PaletteStrip from "./components/PaletteStrip.jsx";
import SavedPaletteWheel from "./components/SavedPaletteWheel.jsx";
import ColorBrainControls from "./components/ColorBrainControls.jsx";
import {
	analyzeCustomSwatchVisualFit,
	analyzeScreenshotVariants,
	categorizeSelectedVariant,
	fileToBase64,
	improveVariant,
	normalizeElement,
	upsertVariantByIndex,
} from "./lib/aiAnalysis.js";
import {
	applyPaletteToElements,
	resetElementStyles,
} from "./lib/paletteEngine.js";
import { generateColorBrainPalettes } from "./lib/colorBrain/index.js";
import {
	mixHexColors,
	hexToRgbColor,
	rgbToHexColor,
	shiftHexHue,
} from "./lib/colorUtils.js";
import { CUSTOM_SWATCH_ROLE_RE, VALID_ROLES } from "./lib/constants.js";

const DEFAULT_LOCKED_ROLES = {
	primary: false,
	secondary: false,
	accent: false,
	text: false,
	textMuted: false,
};

const DEFAULT_LOCKED_COLORS = {
	primary: null,
	secondary: null,
	accent: null,
	text: null,
	textMuted: null,
};

const STORAGE_KEY = "ui-palette-explorer.session.v3";
const LEGACY_STORAGE_KEY = "ui-palette-explorer.session.v2";
const SAVED_PALETTES_KEY = "ui-palette-explorer.saved-palettes.v1";
const SELECTED_VARIANT_SNAPSHOT_MAX_BYTES = 4_500_000;
const PALETTE_BATCH_SIZE = 30;
const API_ANCHOR_COUNT = 6;
const MAX_PALETTES_PER_ANCHOR = 5;
const PREFETCH_AFTER_PALETTES = 15;
const DEFAULT_COLORBRAIN_SETTINGS = {
	creativity: "balanced",
	theme: "auto",
};
const IMPROVE_FAILURE_MESSAGE = "upload a better screenshot for better results";

async function createColorBrainApiPaletteBatch(
	batchId = 0,
	settings = DEFAULT_COLORBRAIN_SETTINGS,
) {
	try {
		const response = await fetch("/api/colorbrain/anchors", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				source: "mixed",
				count: API_ANCHOR_COUNT,
				creativity: settings.creativity,
				theme: settings.theme,
				randomSeed: `colorBrain-api-anchor-${settings.creativity}-${settings.theme}-${batchId}`,
			}),
		});

		if (!response.ok) return [];

		const result = await response.json();
		if (
			!Array.isArray(result.anchorPalettes) ||
			result.anchorPalettes.length === 0
		) {
			return [];
		}

		const generated = generateColorBrainPalettes({
			count: PALETTE_BATCH_SIZE,
			anchorPalettes: result.anchorPalettes,
			maxPalettesPerAnchor: MAX_PALETTES_PER_ANCHOR,
			creativity: settings.creativity,
			theme: settings.theme,
			randomSeed: `colorBrain-api-${settings.creativity}-${settings.theme}-${batchId}`,
		});

		return generated.legacyPalettes;
	} catch (error) {
		console.warn("Failed to fetch colorBrain API anchors", error);
		return [];
	}
}

function readStoredSession() {
	try {
		const raw =
			window.localStorage.getItem(STORAGE_KEY) ||
			window.localStorage.getItem(LEGACY_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed.html !== "string") return null;
		return parsed;
	} catch (error) {
		console.warn("Failed to restore saved palette session", error);
		return null;
	}
}

function readSavedPalettes() {
	try {
		const raw = window.localStorage.getItem(SAVED_PALETTES_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch (error) {
		console.warn("Failed to restore saved palettes", error);
		return [];
	}
}

function estimateJsonSize(value) {
	try {
		return JSON.stringify(value).length;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

function normalizeVariantScreenshot(image) {
	if (!image) return null;
	if (typeof image === "string") {
		return { value: image, kind: "string" };
	}
	if (image.base64) {
		return {
			base64: image.base64,
			mediaType: image.mediaType || "image/png",
			kind: "base64",
		};
	}
	if (image.relativePath) {
		return {
			relativePath: image.relativePath,
			mediaType: image.mediaType || "image/png",
			kind: "relativePath",
		};
	}
	return null;
}

function createSelectedVariantSnapshot(variant) {
	const screenshot = normalizeVariantScreenshot(variant?.renderedScreenshot);
	if (!variant || !screenshot) return null;
	const snapshot = {
		variantId: variant.id,
		variantIndex: variant.index,
		modelId: variant.modelId || "",
		isImproved: Boolean(variant.isImproved),
		screenshot,
		capturedAt: new Date().toISOString(),
	};
	return estimateJsonSize(snapshot) <= SELECTED_VARIANT_SNAPSHOT_MAX_BYTES
		? snapshot
		: null;
}

function normalizeSelectedVariantSnapshot(snapshot) {
	if (!snapshot?.variantId || !snapshot?.screenshot) return null;
	return {
		variantId: String(snapshot.variantId),
		variantIndex: Number.isFinite(snapshot.variantIndex)
			? snapshot.variantIndex
			: null,
		modelId: typeof snapshot.modelId === "string" ? snapshot.modelId : "",
		isImproved: Boolean(snapshot.isImproved),
		screenshot: snapshot.screenshot,
		capturedAt:
			typeof snapshot.capturedAt === "string" ? snapshot.capturedAt : "",
	};
}

function dataUrlToImagePayload(dataUrl) {
	const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
	return match ? { mediaType: match[1], base64: match[2] } : null;
}

async function blobToImagePayload(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const payload = dataUrlToImagePayload(reader.result);
			if (payload) resolve(payload);
			else reject(new Error("Could not read selected variant screenshot."));
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

async function getSelectedVariantSnapshotImage(snapshot) {
	const screenshot = snapshot?.screenshot;
	if (!screenshot) return null;
	if (screenshot.base64) {
		return {
			base64: screenshot.base64,
			mediaType: screenshot.mediaType || "image/png",
		};
	}
	if (typeof screenshot.value === "string") {
		const dataUrlPayload = dataUrlToImagePayload(screenshot.value);
		if (dataUrlPayload) return dataUrlPayload;
		return { base64: screenshot.value, mediaType: "image/png" };
	}
	if (screenshot.relativePath) {
		const path = screenshot.relativePath.startsWith("/")
			? screenshot.relativePath
			: `/${screenshot.relativePath}`;
		const response = await fetch(path);
		if (!response.ok) return null;
		return blobToImagePayload(await response.blob());
	}
	return null;
}

function normalizeCustomSwatches(swatches) {
	return Array.isArray(swatches)
		? swatches
				.filter((swatch) => swatch?.id && swatch?.color)
				.map((swatch) => ({
					id: String(swatch.id),
					label: swatch.label || "Custom",
					color: swatch.color,
					insertAfterKey: swatch.insertAfterKey || null,
					intent: swatch.intent || "auto",
					applicationMode: swatch.applicationMode || "auto",
					userLockedIntent: Boolean(swatch.userLockedIntent),
				}))
		: [];
}

const PALETTE_SWATCH_ORDER = [
	"primary",
	"secondary",
	"accent",
	"text",
	"textMuted",
];

const CUSTOM_SWATCH_HUE_OFFSETS = [137, 274, 72, 209, 326, 108, 245];

function colorDistance(leftHex, rightHex) {
	const left = hexToRgbColor(leftHex);
	const right = hexToRgbColor(rightHex);
	if (!left || !right) return Number.POSITIVE_INFINITY;
	return Math.sqrt(
		(left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2,
	);
}

function nudgeDerivedColor(hex, index = 0) {
	const rgb = hexToRgbColor(hex);
	if (!rgb) return "#888888";
	const max = Math.max(rgb.r, rgb.g, rgb.b);
	const lift = 16 + (index % 3) * 8;
	return rgbToHexColor({
		r: rgb.r === max ? rgb.r + lift : rgb.r - lift * 0.2,
		g: rgb.g === max ? rgb.g + lift : rgb.g - lift * 0.2,
		b: rgb.b === max ? rgb.b + lift : rgb.b - lift * 0.2,
	});
}

function deriveIndependentCustomSwatchColor(palette, index = 0) {
	const base =
		palette?.accent || palette?.secondary || palette?.primary || "#8b5cf6";
	const backgroundLuminance = colorDistance(palette?.primary, "#ffffff") < 150;
	const targetLightness = backgroundLuminance ? 0.5 : 0.66;
	const protectedColors = [
		palette?.primary,
		palette?.secondary,
		palette?.accent,
	].filter(Boolean);

	for (
		let attempt = 0;
		attempt < CUSTOM_SWATCH_HUE_OFFSETS.length;
		attempt += 1
	) {
		const offset =
			CUSTOM_SWATCH_HUE_OFFSETS[
				(index + attempt) % CUSTOM_SWATCH_HUE_OFFSETS.length
			];
		const candidate = shiftHexHue(base, offset + index * 19, {
			minSaturation: 0.56,
			lightness: targetLightness,
		});
		if (
			protectedColors.every((color) => colorDistance(candidate, color) > 72)
		) {
			return candidate;
		}
	}

	return shiftHexHue(
		base,
		CUSTOM_SWATCH_HUE_OFFSETS[index % CUSTOM_SWATCH_HUE_OFFSETS.length],
		{
			minSaturation: 0.62,
			lightness: targetLightness,
		},
	);
}

function resolveBaseAnchorKey(insertAfterKey, normalizedSwatches) {
	let key = insertAfterKey;
	const seen = new Set();
	while (key && !PALETTE_SWATCH_ORDER.includes(key) && !seen.has(key)) {
		seen.add(key);
		key = normalizedSwatches.find(
			(swatch) => swatch.id === key,
		)?.insertAfterKey;
	}
	return PALETTE_SWATCH_ORDER.includes(key) ? key : "accent";
}

function getCustomSwatchElementIntent(elements = []) {
	const haystack = elements
		.map((element) =>
			[
				element.kind,
				element.groupLabel,
				element.label,
				element.paletteId,
				element.dataEl,
				element.text,
				element.rationale,
			]
				.filter(Boolean)
				.join(" "),
		)
		.join(" ")
		.toLowerCase();
	const kinds = new Set(
		elements.map((element) => element.kind).filter(Boolean),
	);

	if (/\b(poll|option|choice|answer|vote)\b/.test(haystack)) {
		return "choice";
	}
	if (/\b(badge|chip|pill|tag|tab|status)\b/.test(haystack)) {
		return "badge";
	}
	if (kinds.has("button") || /\b(button|cta|action)\b/.test(haystack)) {
		return "button";
	}
	if (kinds.has("input") || /\b(input|field|select|control)\b/.test(haystack)) {
		return "control";
	}
	if (
		kinds.has("card") ||
		kinds.has("surface") ||
		/\b(card|panel|tile|surface|container)\b/.test(haystack)
	) {
		return "surface";
	}
	if (kinds.has("icon")) return "icon";
	if (kinds.has("text") || kinds.has("title")) return "text";
	return "default";
}

function resolveSemanticCustomSwatchTokens(
	palette,
	intent,
	fallbackColor,
	index,
) {
	const background = palette.primary || "#ffffff";
	const surface = palette.secondary || background;
	const accent = fallbackColor || palette.accent || "#8b5cf6";
	const text = palette.text || "#111827";
	const onAccent = palette.onAccent || text;

	if (intent === "choice") {
		const tint = mixHexColors(surface, accent, 0.14 + (index % 2) * 0.06);
		return {
			applicationMode: "softTintWithBorder",
			color: accent,
			tokens: {
				background: tint,
				border: mixHexColors(surface, accent, 0.52),
				text,
				icon: accent,
			},
		};
	}
	if (intent === "badge") {
		const fill = mixHexColors(surface, accent, 0.24);
		return {
			applicationMode: "softTint",
			color: accent,
			tokens: {
				background: fill,
				border: mixHexColors(surface, accent, 0.36),
				text,
				icon: accent,
			},
		};
	}
	if (intent === "control" || intent === "surface") {
		const fill = mixHexColors(surface, accent, 0.1);
		return {
			applicationMode: "surfaceWithBorder",
			color: accent,
			tokens: {
				background: fill,
				border: mixHexColors(surface, accent, 0.42),
				text,
				icon: accent,
			},
		};
	}
	if (intent === "button") {
		const fill = mixHexColors(accent, surface, 0.08);
		return {
			applicationMode: "solidFill",
			color: fill,
			tokens: {
				background: fill,
				border: fill,
				text: onAccent,
				icon: onAccent,
			},
		};
	}
	if (intent === "icon") {
		return {
			applicationMode: "iconOnly",
			color: accent,
			tokens: { icon: accent, text: accent, border: accent },
		};
	}
	if (intent === "text") {
		return {
			applicationMode: "textOnly",
			color: accent,
			tokens: { text: accent, icon: accent },
		};
	}
	return {
		applicationMode: "smartDefault",
		color: fallbackColor,
		tokens: {
			background: fallbackColor,
			border: fallbackColor,
			text,
			icon: fallbackColor,
		},
	};
}

function resolveCustomSwatchesForPalette(
	palette,
	customSwatches = [],
	hiddenSwatches = [],
	elements = [],
	lockedRoles = {},
	lockedColors = {},
) {
	const normalizedSwatches = normalizeCustomSwatches(customSwatches);
	if (!palette) return normalizedSwatches;

	const hiddenSwatchSet = new Set(hiddenSwatches);
	const visibleRoleSwatches = PALETTE_SWATCH_ORDER.filter(
		(key) => palette[key] && !hiddenSwatchSet.has(key),
	).map((key) => ({ key, color: palette[key] }));
	const roleColorByKey = new Map(
		visibleRoleSwatches.map((swatch) => [swatch.key, swatch.color]),
	);
	const resolvedById = new Map();

	function getAnchorColor(key) {
		return (
			resolvedById.get(key)?.color ||
			roleColorByKey.get(key) ||
			palette.accent ||
			palette.secondary ||
			"#888888"
		);
	}

	function getNextRoleColor(anchorKey) {
		const baseAnchorKey = resolveBaseAnchorKey(anchorKey, normalizedSwatches);
		const baseIndex = visibleRoleSwatches.findIndex(
			(swatch) => swatch.key === baseAnchorKey,
		);
		const nextRole =
			baseIndex >= 0
				? visibleRoleSwatches[baseIndex + 1] || visibleRoleSwatches[0]
				: visibleRoleSwatches[0];
		return nextRole?.color || palette.secondary || palette.accent || "#888888";
	}

	return normalizedSwatches.map((swatch, index) => {
		const anchorColor = getAnchorColor(swatch.insertAfterKey);
		const nextColor = getNextRoleColor(swatch.insertAfterKey);
		const mixAmount = 0.38 + (index % 3) * 0.12;
		const harmonyHint = nudgeDerivedColor(
			mixHexColors(anchorColor, nextColor, mixAmount),
			index,
		);
		const fallbackColor = mixHexColors(
			deriveIndependentCustomSwatchColor(palette, index),
			harmonyHint,
			0.18,
		);
		const assignedElements = elements.filter(
			(element) => element.role === swatch.id,
		);
		const inferredIntent = getCustomSwatchElementIntent(assignedElements);
		const intent =
			swatch.userLockedIntent && swatch.intent !== "auto"
				? swatch.intent
				: inferredIntent;
		const lockedColor = lockedRoles[swatch.id] ? lockedColors[swatch.id] : null;
		const semanticSwatch = resolveSemanticCustomSwatchTokens(
			palette,
			intent,
			lockedColor || fallbackColor,
			index,
		);
		const resolvedSwatch = {
			...swatch,
			intent,
			inferredIntent,
			applicationMode:
				swatch.applicationMode !== "auto"
					? swatch.applicationMode
					: semanticSwatch.applicationMode,
			color: semanticSwatch.color,
			tokens: semanticSwatch.tokens,
		};
		resolvedById.set(resolvedSwatch.id, resolvedSwatch);
		return resolvedSwatch;
	});
}

// Custom swatch colors are runtime-resolved from the active palette and the
// assigned elements' intent. Persisted `.color` is kept as the deterministic
// fallback/last display color, not as the authority for semantic custom roles.
function createPaletteSignature(
	palette,
	customSwatches = [],
	hiddenSwatches = [],
) {
	return JSON.stringify({
		primary: palette?.primary,
		secondary: palette?.secondary,
		accent: palette?.accent,
		text: palette?.text,
		textMuted: palette?.textMuted,
		onAccent: palette?.onAccent,
		customSwatches: normalizeCustomSwatches(customSwatches).map((swatch) => ({
			label: swatch.label,
			color: swatch.color,
			insertAfterKey: swatch.insertAfterKey,
			intent: swatch.intent,
			applicationMode: swatch.applicationMode,
		})),
		hiddenSwatches: [...hiddenSwatches].sort(),
	});
}

function createSavedPaletteRecord(palette, customSwatches, hiddenSwatches) {
	const savedPalette = {
		...palette,
		_colorBrain: palette?._colorBrain,
	};
	const normalizedCustomSwatches = normalizeCustomSwatches(customSwatches);
	const normalizedHiddenSwatches = Array.isArray(hiddenSwatches)
		? hiddenSwatches.filter(Boolean)
		: [];
	return {
		id: `saved-${Date.now()}`,
		name: palette?.name || palette?._colorBrain?.name || "Saved palette",
		palette: savedPalette,
		customSwatches: normalizedCustomSwatches,
		hiddenSwatches: normalizedHiddenSwatches,
		signature: createPaletteSignature(
			savedPalette,
			normalizedCustomSwatches,
			normalizedHiddenSwatches,
		),
		savedAt: new Date().toISOString(),
	};
}

export default function App() {
	// ── Upload / AI analysis state ──
	const [isProcessing, setIsProcessing] = useState(false);
	const [statusMessage, setStatusMessage] = useState("");
	const [analysisProgress, setAnalysisProgress] = useState(0);
	const [error, setError] = useState(null);
	const [uploadedImage, setUploadedImage] = useState(null);
	const [variants, setVariants] = useState([]);
	const [selectedVariantId, setSelectedVariantId] = useState(null);
	const [recommendedVariantId, setRecommendedVariantId] = useState(null);
	const [isCategorizing, setIsCategorizing] = useState(false);
	const [improvingVariantId, setImprovingVariantId] = useState(null);
	const [highlightedVariantId, setHighlightedVariantId] = useState(null);

	// ── Result of the AI call ──
	const [html, setHtml] = useState(null);
	const [elements, setElements] = useState([]);
	const [previewInventory, setPreviewInventory] = useState([]);
	const [selectedVariantSnapshot, setSelectedVariantSnapshot] = useState(null);

	// ── Palette cycling state ──
	const [colorBrainSettings, setColorBrainSettings] = useState(
		DEFAULT_COLORBRAIN_SETTINGS,
	);
	const [paletteBatch, setPaletteBatch] = useState([]);
	const [paletteIndex, setPaletteIndex] = useState(0);
	const [isPaletteActive, setIsPaletteActive] = useState(false);
	const [isInitialPaletteLoading, setIsInitialPaletteLoading] = useState(true);
	const [initialPaletteError, setInitialPaletteError] = useState(null);
	const [isGeneratingMorePalettes, setIsGeneratingMorePalettes] =
		useState(false);
	const [paletteGenerationMessage, setPaletteGenerationMessage] = useState("");
	const [paletteGenerationStatus, setPaletteGenerationStatus] =
		useState("idle");
	const [lockedRoles, setLockedRoles] = useState(DEFAULT_LOCKED_ROLES);
	const [lockedColors, setLockedColors] = useState(DEFAULT_LOCKED_COLORS);
	const [customSwatches, setCustomSwatches] = useState([]);
	const [hiddenSwatches, setHiddenSwatches] = useState([]);
	const [improvingCustomSwatchId, setImprovingCustomSwatchId] = useState(null);
	const [savedPalettes, setSavedPalettes] = useState(readSavedPalettes);
	const [previewMode, setPreviewMode] = useState("desktop");
	const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
	const [isPanelDrawerOpen, setIsPanelDrawerOpen] = useState(true);
	const [isColorBrainDrawerOpen, setIsColorBrainDrawerOpen] = useState(false);

	// ── Hover highlight state (from kanban -> preview) ──
	const [highlightedId, setHighlightedId] = useState(null);
	const [highlightedInventoryItem, setHighlightedInventoryItem] =
		useState(null);

	const previewRootRef = useRef(null);
	const nextPaletteBatchRef = useRef(1);
	const isGeneratingPalettesRef = useRef(false);
	const initialPaletteLoadPromiseRef = useRef(null);
	const paletteBatchRangesRef = useRef([]);
	const paletteHistoryRef = useRef([]);
	const [isSessionReady, setIsSessionReady] = useState(false);
	const hasAnyElements = elements.length > 0;
	const currentPalette =
		paletteBatch.length > 0
			? paletteBatch[paletteIndex % paletteBatch.length]
			: null;
	const highlightedElement =
		highlightedInventoryItem ||
		(highlightedId ? elements.find((el) => el.id === highlightedId) : null);
	const selectedVariant =
		variants.find((variant) => variant.id === selectedVariantId) || null;
	const viewState = html
		? "workspace"
		: variants.length > 0 || uploadedImage
			? "variant"
			: "upload";
	const effectivePalette = useMemo(() => {
		if (!currentPalette) return null;
		return {
			...currentPalette,
			primary: lockedRoles.primary
				? (lockedColors.primary ?? currentPalette.primary)
				: currentPalette.primary,
			secondary: lockedRoles.secondary
				? (lockedColors.secondary ?? currentPalette.secondary)
				: currentPalette.secondary,
			accent: lockedRoles.accent
				? (lockedColors.accent ?? currentPalette.accent)
				: currentPalette.accent,
			text: lockedRoles.text
				? (lockedColors.text ?? currentPalette.text)
				: currentPalette.text,
			textMuted: lockedRoles.textMuted
				? (lockedColors.textMuted ?? currentPalette.textMuted)
				: currentPalette.textMuted,
		};
	}, [currentPalette, lockedRoles, lockedColors]);
	const resolvedCustomSwatches = useMemo(
		() =>
			resolveCustomSwatchesForPalette(
				effectivePalette,
				customSwatches,
				hiddenSwatches,
				elements,
				lockedRoles,
				lockedColors,
			),
		[
			customSwatches,
			effectivePalette,
			elements,
			hiddenSwatches,
			lockedColors,
			lockedRoles,
		],
	);
	const currentPaletteSignature = effectivePalette
		? createPaletteSignature(
				effectivePalette,
				resolvedCustomSwatches,
				hiddenSwatches,
			)
		: null;
	const isCurrentPaletteSaved = Boolean(
		currentPaletteSignature &&
			savedPalettes.some(
				(savedPalette) => savedPalette.signature === currentPaletteSignature,
			),
	);

	useEffect(() => {
		let isCancelled = false;

		async function initializeAppSession() {
			const stored = readStoredSession();
			const storedColorBrainSettings = {
				...DEFAULT_COLORBRAIN_SETTINGS,
				...(stored?.colorBrainSettings || {}),
			};

			if (stored) {
				setHtml(stored.html);
				setElements(
					(stored.elements || []).map((element) => normalizeElement(element)),
				);
				setColorBrainSettings(storedColorBrainSettings);
				setPaletteIndex(0);
				setIsPaletteActive(Boolean(stored.isPaletteActive));
				setLockedRoles({
					...DEFAULT_LOCKED_ROLES,
					...(stored.lockedRoles || {}),
				});
				setLockedColors({
					...DEFAULT_LOCKED_COLORS,
					...(stored.lockedColors || {}),
				});
				setCustomSwatches(normalizeCustomSwatches(stored.customSwatches));
				setHiddenSwatches(
					Array.isArray(stored.hiddenSwatches) ? stored.hiddenSwatches : [],
				);
				setSelectedVariantSnapshot(
					normalizeSelectedVariantSnapshot(stored.selectedVariantSnapshot),
				);
				setPreviewMode(stored.previewMode === "mobile" ? "mobile" : "desktop");
			}

			setIsInitialPaletteLoading(true);
			setInitialPaletteError(null);

			try {
				const initialPaletteLoadPromise =
					initialPaletteLoadPromiseRef.current ||
					createColorBrainApiPaletteBatch(0, storedColorBrainSettings);
				initialPaletteLoadPromiseRef.current = initialPaletteLoadPromise;
				const initialBatch = await initialPaletteLoadPromise;
				if (isCancelled) return;

				if (initialBatch.length === 0) {
					throw new Error("Could not generate colors for your app.");
				}

				paletteBatchRangesRef.current = [
					{ start: 0, size: initialBatch.length, prefetched: false },
				];
				nextPaletteBatchRef.current = 1;
				setPaletteBatch(initialBatch);
				setPaletteIndex(0);
			} catch (error) {
				if (!isCancelled) {
					setInitialPaletteError(
						error.message || "Could not generate colors for your app.",
					);
				}
			} finally {
				if (!isCancelled) {
					setIsInitialPaletteLoading(false);
					setIsSessionReady(true);
				}
			}
		}

		void initializeAppSession();

		return () => {
			isCancelled = true;
		};
	}, []);

	useEffect(() => {
		setPreviewInventory([]);
		setHighlightedInventoryItem(null);
		setElements((current) => {
			if (!current.some((element) => element.source === "manual-inventory")) {
				return current;
			}
			return current.filter((element) => element.source !== "manual-inventory");
		});
	}, [html]);

	useEffect(() => {
		if (!isSessionReady) return;
		try {
			if (!html) {
				window.localStorage.removeItem(STORAGE_KEY);
				window.localStorage.removeItem(LEGACY_STORAGE_KEY);
				return;
			}

			window.localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({
					html,
					elements,
					paletteIndex,
					isPaletteActive,
					lockedRoles,
					lockedColors,
					customSwatches,
					hiddenSwatches,
					selectedVariantSnapshot,
					previewMode,
					colorBrainSettings,
					savedAt: new Date().toISOString(),
				}),
			);
		} catch (error) {
			console.warn("Failed to save palette session", error);
		}
	}, [
		elements,
		html,
		isPaletteActive,
		isSessionReady,
		colorBrainSettings,
		customSwatches,
		hiddenSwatches,
		lockedColors,
		lockedRoles,
		paletteIndex,
		previewMode,
		selectedVariantSnapshot,
	]);

	useEffect(() => {
		try {
			window.localStorage.setItem(
				SAVED_PALETTES_KEY,
				JSON.stringify(savedPalettes),
			);
		} catch (error) {
			console.warn("Failed to save favorite palettes", error);
		}
	}, [savedPalettes]);

	useEffect(() => {
		if (!isProcessing) return undefined;

		const startedAt = Date.now();
		const timer = window.setInterval(() => {
			const elapsed = Date.now() - startedAt;
			const easedProgress = 12 + (1 - Math.exp(-elapsed / 85000)) * 82;
			setAnalysisProgress((current) =>
				Math.min(96, Math.max(current, Math.round(easedProgress))),
			);
		}, 800);

		return () => window.clearInterval(timer);
	}, [isProcessing]);

	// ── Handle upload ──
	const handleFileSelected = useCallback(async (file) => {
		setIsProcessing(true);
		setAnalysisProgress(3);
		setError(null);
		setStatusMessage("Reading image...");
		setUploadedImage(null);
		setVariants([]);
		setSelectedVariantId(null);
		setRecommendedVariantId(null);
		setImprovingVariantId(null);
		setHighlightedVariantId(null);
		setHtml(null);
		setElements([]);
		setSelectedVariantSnapshot(null);
		setHighlightedId(null);

		try {
			const base64 = await fileToBase64(file);
			const mediaType = file.type || "image/png";
			setUploadedImage({ base64, mediaType, name: file.name });
			setAnalysisProgress(10);
			setStatusMessage("Generating layout variants...");

			await analyzeScreenshotVariants(base64, mediaType, {
				onProgress: (event) => {
					setStatusMessage(event.message || "Generating variants...");
					if (typeof event.progress === "number") {
						setAnalysisProgress(event.progress);
					}
				},
				onVariant: (variant) => {
					setVariants((prev) => upsertVariantByIndex(prev, variant));
					setStatusMessage(
						`Variant ${variant.index} ready. Select it or wait for the rest...`,
					);
				},
				onVariantEvaluated: (event) => {
					if (typeof event.progress === "number") {
						setAnalysisProgress(event.progress);
					}
					setVariants((prev) =>
						prev.map((variant) =>
							variant.id === event.variantId
								? {
										...variant,
										score: event.score,
										visualEvaluation: event.visualEvaluation,
										renderedScreenshot:
											event.renderedScreenshot || variant.renderedScreenshot,
									}
								: variant,
						),
					);
				},
				onVariantFailed: (event) => {
					setStatusMessage(
						`Variant ${event.index} failed; continuing with the others...`,
					);
				},
				onComplete: (event) => {
					setRecommendedVariantId(event.recommendedVariantId);
					setStatusMessage("Choose the version you want to palette-edit.");
					setAnalysisProgress(100);
				},
			});
		} catch (err) {
			console.error(err);
			setError(err.message || "Something went wrong analyzing the image.");
			setStatusMessage("");
		} finally {
			setIsProcessing(false);
		}
	}, []);

	const handleUseSelectedVariant = useCallback(async () => {
		if (!selectedVariant || !uploadedImage) return;
		setIsCategorizing(true);
		setError(null);
		setStatusMessage("Mapping palette roles for your selected version...");

		try {
			const result = await categorizeSelectedVariant({
				html: selectedVariant.html,
				base64: uploadedImage.base64,
				mediaType: uploadedImage.mediaType,
				variantId: selectedVariant.id,
			});

			setHtml(result.html);
			setElements(result.elements);
			setSelectedVariantSnapshot(
				createSelectedVariantSnapshot(selectedVariant),
			);
			setPaletteIndex(0);
			setIsPaletteActive(false);
			setLockedRoles(DEFAULT_LOCKED_ROLES);
			setLockedColors(DEFAULT_LOCKED_COLORS);
			setCustomSwatches([]);
			setHiddenSwatches([]);
			setPreviewMode("desktop");
			setHighlightedId(null);
		} catch (err) {
			console.error(err);
			setError(err.message || "Failed to map palette roles.");
		} finally {
			setIsCategorizing(false);
			setStatusMessage("");
		}
	}, [selectedVariant, uploadedImage]);

	const handleImproveVariant = useCallback(
		async (variantId) => {
			const sourceVariant = variants.find(
				(variant) => variant.id === variantId,
			);
			if (!sourceVariant || !uploadedImage) return;

			if (sourceVariant.isImproved) {
				setError(IMPROVE_FAILURE_MESSAGE);
				return;
			}

			setImprovingVariantId(variantId);
			setHighlightedVariantId(null);
			setError(null);
			setStatusMessage("Improving selected variant...");

			try {
				const result = await improveVariant({
					html: sourceVariant.html,
					base64: uploadedImage.base64,
					mediaType: uploadedImage.mediaType,
					variantId: sourceVariant.id,
					modelId: sourceVariant.modelId,
				});
				const improvedVariantId = `${sourceVariant.id}-improved-${Date.now()}`;
				const improvedVariant = {
					...result,
					id: improvedVariantId,
					index: variants.length + 1,
					modelId: result.modelId || sourceVariant.modelId,
					parentVariantId: sourceVariant.id,
					isImproved: true,
				};

				setVariants((current) => [...current, improvedVariant]);
				setHighlightedVariantId(improvedVariantId);
				setStatusMessage(
					"Improved variant added. Select it if it looks better.",
				);
			} catch (err) {
				console.error(err);
				setError(IMPROVE_FAILURE_MESSAGE);
				setStatusMessage("");
			} finally {
				setImprovingVariantId(null);
			}
		},
		[uploadedImage, variants],
	);

	// ── Apply current palette whenever it changes (or elements change) ──
	useEffect(() => {
		if (
			!isPaletteActive ||
			!effectivePalette ||
			!hasAnyElements ||
			!previewRootRef.current
		)
			return;
		applyPaletteToElements(
			elements,
			{ ...effectivePalette, customSwatches: resolvedCustomSwatches },
			previewRootRef.current,
		);
	}, [
		effectivePalette,
		elements,
		hasAnyElements,
		html,
		isPaletteActive,
		resolvedCustomSwatches,
	]);

	useEffect(() => {
		const activeCustomRoleIds = new Set(
			customSwatches.map((swatch) => swatch.id),
		);
		const staleCustomRoleElements = elements.filter(
			(element) =>
				CUSTOM_SWATCH_ROLE_RE.test(element.role) &&
				!activeCustomRoleIds.has(element.role),
		);
		if (staleCustomRoleElements.length === 0) return;

		resetElementStyles(staleCustomRoleElements, previewRootRef.current);
		setHighlightedId((current) =>
			staleCustomRoleElements.some((element) => element.id === current)
				? null
				: current,
		);
		setElements((current) =>
			current.map((element) =>
				CUSTOM_SWATCH_ROLE_RE.test(element.role) &&
				!activeCustomRoleIds.has(element.role)
					? { ...element, role: "custom" }
					: element,
			),
		);
	}, [customSwatches, elements]);

	// ── Element changes from the kanban controls ──
	function isAssignableRole(role) {
		return (
			VALID_ROLES.has(role) ||
			customSwatches.some((swatch) => swatch.id === role)
		);
	}

	function isCustomSwatchRole(role) {
		return customSwatches.some((swatch) => swatch.id === role);
	}

	function handleChangeRole(elementId, newRole) {
		const safeRole = isAssignableRole(newRole) ? newRole : "custom";
		setElements((prev) =>
			prev.map((el) =>
				el.id === elementId
					? {
							...el,
							role: safeRole,
							textLocked: isCustomSwatchRole(safeRole) ? false : el.textLocked,
						}
					: el,
			),
		);
	}

	function handleAddInventoryElement(role, item) {
		const safeRole = isAssignableRole(role) ? role : "secondary";
		if (!item?.inventoryId || !item?.selector) {
			return { ok: false, error: "Select a preview element first." };
		}

		const inventoryItem = previewInventory.find(
			(candidate) =>
				candidate.inventoryId === item.inventoryId &&
				candidate.selector === item.selector,
		);
		if (!inventoryItem) {
			return {
				ok: false,
				error: "That preview element is no longer available.",
			};
		}

		const alreadyAdded = elements.some((element) => {
			return (
				element.inventoryId === inventoryItem.inventoryId ||
				element.selector === inventoryItem.selector ||
				element.selectors?.includes(inventoryItem.selector)
			);
		});
		if (alreadyAdded) {
			return {
				ok: false,
				error: "That preview element is already in the board.",
			};
		}

		setElements((prev) => [
			...prev,
			normalizeElement({
				id: `manual-inventory-${inventoryItem.inventoryId}`,
				selector: inventoryItem.selector,
				selectors: [inventoryItem.selector],
				label: inventoryItem.label,
				role: safeRole,
				swatch: inventoryItem.swatch,
				isText: inventoryItem.isText,
				textLocked: isCustomSwatchRole(safeRole) ? false : inventoryItem.isText,
				source: "manual-inventory",
				inventoryId: inventoryItem.inventoryId,
				kind: inventoryItem.kind,
				groupLabel: inventoryItem.groupLabel,
				paletteId: inventoryItem.paletteId,
				dataEl: inventoryItem.dataEl,
				text: inventoryItem.text,
				rationale: "Picked from the generated preview.",
			}),
		]);
		setHighlightedId(null);
		setHighlightedInventoryItem(null);
		return { ok: true };
	}

	function handleRemoveElement(id) {
		const target = elements.find((el) => el.id === id);
		if (!target) return;

		resetElementStyles([target], previewRootRef.current);
		setHighlightedId((prev) => (prev === id ? null : prev));

		if (target.role !== "custom") {
			setElements((prev) =>
				prev.map((el) => (el.id === id ? { ...el, role: "custom" } : el)),
			);
			return;
		}

		setElements((prev) => prev.filter((el) => el.id !== id));
	}

	function handleRenameElement(id, label) {
		const nextLabel = label.trim();
		if (!nextLabel) return;

		setElements((prev) =>
			prev.map((el) => (el.id === id ? { ...el, label: nextLabel } : el)),
		);
	}

	function handleToggleTextLock(id) {
		setElements((prev) =>
			prev.map((el) =>
				el.id === id && el.isText ? { ...el, textLocked: !el.textLocked } : el,
			),
		);
	}

	// ── Role color locks ──
	function handleToggleRoleLock(role) {
		const isBaseRole = [
			"primary",
			"secondary",
			"accent",
			"text",
			"textMuted",
		].includes(role);
		const customSwatch = resolvedCustomSwatches.find(
			(swatch) => swatch.id === role,
		);
		if (!isBaseRole && !customSwatch) return;

		if (lockedRoles[role]) {
			setLockedRoles((prev) => ({ ...prev, [role]: false }));
			setLockedColors((prev) => ({ ...prev, [role]: null }));
			return;
		}

		const colorToLock = isBaseRole
			? effectivePalette?.[role]
			: customSwatch?.color;
		if (!colorToLock) return;

		setIsPaletteActive(true);
		setLockedRoles((prev) => ({ ...prev, [role]: true }));
		setLockedColors((prev) => ({ ...prev, [role]: colorToLock }));
	}

	function handleAddSwatch(color, insertAfterKey = null) {
		setCustomSwatches((current) => {
			const visibleCount =
				PALETTE_SWATCH_ORDER.length - hiddenSwatches.length + current.length;
			if (visibleCount >= 7) return current;
			const nextCustomNumber =
				current.reduce((highest, swatch) => {
					const match = String(swatch.label || "").match(/^Custom\s+(\d+)$/i);
					return match ? Math.max(highest, Number(match[1])) : highest;
				}, 0) + 1;
			return [
				...current,
				{
					id: `custom-${Date.now() + current.length}`,
					label: `Custom ${nextCustomNumber}`,
					color,
					insertAfterKey,
					intent: "auto",
					applicationMode: "auto",
					userLockedIntent: false,
				},
			];
		});
		setIsPaletteActive(true);
	}

	function handleRenameCustomSwatch(key, label) {
		const nextLabel = label.trim();
		if (!nextLabel) return;
		setCustomSwatches((current) =>
			current.map((swatch) =>
				swatch.id === key ? { ...swatch, label: nextLabel } : swatch,
			),
		);
	}

	function handleChangeCustomSwatchIntent(key, intent) {
		setCustomSwatches((current) =>
			current.map((swatch) =>
				swatch.id === key
					? {
							...swatch,
							intent: intent === "auto" ? "auto" : intent,
							applicationMode: "auto",
							userLockedIntent: intent !== "auto",
						}
					: swatch,
			),
		);
		setIsPaletteActive(true);
	}

	async function handleImproveCustomSwatchIntent(key) {
		const swatch = resolvedCustomSwatches.find(
			(candidate) => candidate.id === key,
		);
		if (!swatch || !effectivePalette) return;
		const assignedElements = elements.filter((element) => element.role === key);
		if (assignedElements.length === 0) {
			setStatusMessage(
				"Assign elements to this swatch before visual analysis.",
			);
			return;
		}

		setImprovingCustomSwatchId(key);
		setError(null);
		setStatusMessage("Analyzing custom swatch against the selected variant...");
		try {
			const image = await getSelectedVariantSnapshotImage(
				selectedVariantSnapshot,
			);
			if (!image) {
				throw new Error(
					"Select a generated variant first so we have a visual baseline.",
				);
			}
			const result = await analyzeCustomSwatchVisualFit({
				...image,
				swatch,
				elements: assignedElements,
				palette: effectivePalette,
			});
			setCustomSwatches((current) =>
				current.map((candidate) =>
					candidate.id === key
						? {
								...candidate,
								intent: result.intent || candidate.intent || "auto",
								applicationMode:
									result.applicationMode || candidate.applicationMode || "auto",
								userLockedIntent: Boolean(result.intent),
								visualRationale: result.rationale || "",
								visualConfidence: result.confidence ?? null,
							}
						: candidate,
				),
			);
			setIsPaletteActive(true);
			setStatusMessage(
				"Custom swatch behavior improved from the saved screenshot.",
			);
		} catch (err) {
			console.error(err);
			setError(err.message || "Could not visually analyze this custom swatch.");
			setStatusMessage("");
		} finally {
			setImprovingCustomSwatchId(null);
		}
	}

	function handleDeleteSwatch(key) {
		const visibleCount =
			PALETTE_SWATCH_ORDER.length -
			hiddenSwatches.length +
			customSwatches.length;
		if (visibleCount <= 3) return;

		if (key === "text" || key === "textMuted") {
			setHiddenSwatches((current) =>
				current.includes(key) ? current : [...current, key],
			);
			setLockedRoles((prev) => ({ ...prev, [key]: false }));
			setLockedColors((prev) => ({ ...prev, [key]: null }));
			return;
		}

		const elementsUsingDeletedSwatch = elements.filter(
			(element) => element.role === key,
		);
		resetElementStyles(elementsUsingDeletedSwatch, previewRootRef.current);
		setHighlightedId((current) =>
			elementsUsingDeletedSwatch.some((element) => element.id === current)
				? null
				: current,
		);
		setElements((current) =>
			current.map((element) =>
				element.role === key ? { ...element, role: "custom" } : element,
			),
		);
		setLockedRoles((current) => ({ ...current, [key]: false }));
		setLockedColors((current) => ({ ...current, [key]: null }));
		setCustomSwatches((current) => {
			const deletedSwatch = current.find((swatch) => swatch.id === key);
			return current
				.filter((swatch) => swatch.id !== key)
				.map((swatch) =>
					swatch.insertAfterKey === key
						? {
								...swatch,
								insertAfterKey: deletedSwatch?.insertAfterKey || null,
							}
						: swatch,
				);
		});
	}

	function rememberPaletteIndex(index) {
		paletteHistoryRef.current = [...paletteHistoryRef.current, index].slice(-2);
	}

	function handleToggleSavedPalette() {
		if (!effectivePalette || !currentPaletteSignature) return;

		setSavedPalettes((current) => {
			if (
				current.some(
					(savedPalette) => savedPalette.signature === currentPaletteSignature,
				)
			) {
				return current.filter(
					(savedPalette) => savedPalette.signature !== currentPaletteSignature,
				);
			}

			return [
				createSavedPaletteRecord(
					effectivePalette,
					resolvedCustomSwatches,
					hiddenSwatches,
				),
				...current,
			];
		});
	}

	function handleApplySavedPalette(savedPalette) {
		if (!savedPalette?.palette) return;
		resetElementStyles(elements, previewRootRef.current);
		rememberPaletteIndex(paletteIndex);
		appendPaletteBatch([savedPalette.palette], { selectFirst: true });
		setCustomSwatches(normalizeCustomSwatches(savedPalette.customSwatches));
		setHiddenSwatches(
			Array.isArray(savedPalette.hiddenSwatches)
				? savedPalette.hiddenSwatches
				: [],
		);
		setIsPaletteActive(true);
	}

	const showPaletteGenerationMessage = useCallback(
		(message, status = "info") => {
			setPaletteGenerationMessage(message);
			setPaletteGenerationStatus(status);
		},
		[],
	);

	const replacePaletteBatch = useCallback((nextBatch) => {
		paletteBatchRangesRef.current = nextBatch.length
			? [{ start: 0, size: nextBatch.length, prefetched: false }]
			: [];
		paletteHistoryRef.current = [];
		nextPaletteBatchRef.current = 1;
		setPaletteBatch(nextBatch);
		setPaletteIndex(0);
	}, []);

	const appendPaletteBatch = useCallback(
		(nextBatch, { selectFirst = false } = {}) => {
			if (!Array.isArray(nextBatch) || nextBatch.length === 0) return;

			setPaletteBatch((current) => {
				const start = current.length;
				paletteBatchRangesRef.current = [
					...paletteBatchRangesRef.current,
					{ start, size: nextBatch.length, prefetched: false },
				];

				if (selectFirst) {
					setPaletteIndex(start);
					setIsPaletteActive(true);
				}

				return [...current, ...nextBatch];
			});
		},
		[],
	);

	const handleColorBrainSettingChange = useCallback(
		async (key, value) => {
			const nextSettings = {
				...colorBrainSettings,
				[key]: value,
			};
			setColorBrainSettings(nextSettings);
			setIsGeneratingMorePalettes(true);
			showPaletteGenerationMessage("Generating fresh palette batch...", "info");

			try {
				const nextBatch = await createColorBrainApiPaletteBatch(
					0,
					nextSettings,
				);
				if (nextBatch.length === 0) {
					throw new Error("Could not generate fresh palettes.");
				}
				replacePaletteBatch(nextBatch);
				setIsPaletteActive(true);
				showPaletteGenerationMessage("Fresh palette batch loaded.", "success");
			} catch (error) {
				console.warn("Failed to refresh colorBrain palettes", error);
				showPaletteGenerationMessage(
					"Could not generate fresh palettes. Try again.",
					"error",
				);
			} finally {
				setIsGeneratingMorePalettes(false);
			}
		},
		[colorBrainSettings, replacePaletteBatch, showPaletteGenerationMessage],
	);

	const prefetchPaletteBatch = useCallback(
		async (settings) => {
			if (isGeneratingPalettesRef.current) return;
			isGeneratingPalettesRef.current = true;

			try {
				const batchId = nextPaletteBatchRef.current;
				const nextBatch = await createColorBrainApiPaletteBatch(
					batchId,
					settings,
				);
				if (nextBatch.length > 0) {
					appendPaletteBatch(nextBatch);
					nextPaletteBatchRef.current += 1;
				}
			} finally {
				isGeneratingPalettesRef.current = false;
			}
		},
		[appendPaletteBatch],
	);

	const handleGenerateMorePalettes = useCallback(async () => {
		if (isGeneratingMorePalettes) return;

		setIsGeneratingMorePalettes(true);
		showPaletteGenerationMessage("Generating fresh palette batch...", "info");

		try {
			const batchId = nextPaletteBatchRef.current;
			const nextBatch = await createColorBrainApiPaletteBatch(
				batchId,
				colorBrainSettings,
			);
			if (nextBatch.length === 0) {
				throw new Error("Could not generate fresh palettes.");
			}

			rememberPaletteIndex(paletteIndex);
			appendPaletteBatch(nextBatch, { selectFirst: true });
			nextPaletteBatchRef.current += 1;
			showPaletteGenerationMessage("New palette batch added.", "success");
		} catch (error) {
			console.warn("Failed to generate more colorBrain palettes", error);
			showPaletteGenerationMessage(
				"Could not generate fresh palettes. Try again.",
				"error",
			);
		} finally {
			setIsGeneratingMorePalettes(false);
		}
	}, [
		appendPaletteBatch,
		colorBrainSettings,
		isGeneratingMorePalettes,
		showPaletteGenerationMessage,
	]);

	const maybeGenerateMorePalettes = useCallback(
		(nextIndex) => {
			const activeRange = paletteBatchRangesRef.current.find(
				(range) =>
					nextIndex >= range.start && nextIndex < range.start + range.size,
			);
			if (!activeRange || activeRange.prefetched) return;
			if (nextIndex - activeRange.start < PREFETCH_AFTER_PALETTES) return;

			activeRange.prefetched = true;
			const schedule = window.requestIdleCallback
				? (callback) => window.requestIdleCallback(callback)
				: (callback) => window.setTimeout(callback, 0);
			schedule(() => {
				void prefetchPaletteBatch(colorBrainSettings);
			});
		},
		[colorBrainSettings, prefetchPaletteBatch],
	);

	const moveToNextPalette = useCallback(() => {
		if (paletteBatch.length === 0) return;
		setIsPaletteActive(true);
		setPaletteIndex((index) => {
			const nextIndex = index + 1;
			rememberPaletteIndex(index);
			maybeGenerateMorePalettes(nextIndex);
			return nextIndex;
		});
	}, [maybeGenerateMorePalettes, paletteBatch.length]);

	const moveToPreviousPalette = useCallback(() => {
		if (paletteBatch.length === 0) return;
		const previousIndex = paletteHistoryRef.current.at(-1);
		if (!Number.isInteger(previousIndex)) return;

		paletteHistoryRef.current = paletteHistoryRef.current.slice(0, -1);
		setIsPaletteActive(true);
		setPaletteIndex(previousIndex);
	}, [paletteBatch.length]);

	// ── Keyboard: Space / arrows cycle palettes ──
	useEffect(() => {
		function onKeyDown(e) {
			if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
				return;
			if (!hasAnyElements) return;

			if (e.code === "Space" || e.code === "ArrowRight") {
				e.preventDefault();
				moveToNextPalette();
			} else if (e.code === "ArrowLeft") {
				e.preventDefault();
				moveToPreviousPalette();
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [hasAnyElements, moveToNextPalette, moveToPreviousPalette]);

	function handleResetColors() {
		resetElementStyles(elements, previewRootRef.current);
		setPaletteIndex(0);
		paletteHistoryRef.current = [];
		setIsPaletteActive(false);
		setLockedRoles(DEFAULT_LOCKED_ROLES);
		setLockedColors(DEFAULT_LOCKED_COLORS);
		setElements((current) =>
			current.map((element) =>
				customSwatches.some((swatch) => swatch.id === element.role)
					? { ...element, role: "custom" }
					: element,
			),
		);
		setCustomSwatches([]);
		setHiddenSwatches([]);
		setHighlightedId(null);
		setStatusMessage("Colors reset to the original generated UI.");
	}

	useEffect(() => {
		if (!paletteGenerationMessage) return undefined;

		const timer = window.setTimeout(() => {
			setPaletteGenerationMessage("");
			setPaletteGenerationStatus("idle");
		}, 3500);

		return () => window.clearTimeout(timer);
	}, [paletteGenerationMessage]);

	function handleStartOver() {
		resetElementStyles(elements, previewRootRef.current);
		window.localStorage.removeItem(STORAGE_KEY);
		window.localStorage.removeItem(LEGACY_STORAGE_KEY);
		setHtml(null);
		setElements([]);
		setSelectedVariantSnapshot(null);
		setUploadedImage(null);
		setVariants([]);
		setSelectedVariantId(null);
		setRecommendedVariantId(null);
		setImprovingVariantId(null);
		setHighlightedVariantId(null);
		setPaletteIndex(0);
		paletteHistoryRef.current = [];
		setIsPaletteActive(false);
		setLockedRoles(DEFAULT_LOCKED_ROLES);
		setLockedColors(DEFAULT_LOCKED_COLORS);
		setCustomSwatches([]);
		setHiddenSwatches([]);
		setPreviewMode("desktop");
		setIsPanelDrawerOpen(true);
		setAnalysisProgress(0);
		setStatusMessage("");
		setError(null);
	}

	async function handleRetryInitialPalettes() {
		setIsInitialPaletteLoading(true);
		setInitialPaletteError(null);

		try {
			const nextBatch = await createColorBrainApiPaletteBatch(
				0,
				colorBrainSettings,
			);
			if (nextBatch.length === 0) {
				throw new Error("Could not generate colors for your app.");
			}
			replacePaletteBatch(nextBatch);
		} catch (error) {
			setInitialPaletteError(
				error.message || "Could not generate colors for your app.",
			);
		} finally {
			setIsInitialPaletteLoading(false);
		}
	}

	if (
		isInitialPaletteLoading ||
		(initialPaletteError && paletteBatch.length === 0)
	) {
		return (
			<div className="palette-loading-screen" role="status" aria-live="polite">
				<div className="palette-loading-card">
					<span className="palette-loading-spinner" aria-hidden="true" />
					<h1>Generating colors for your app...</h1>
					<p>
						{initialPaletteError ||
							"Fetching fresh color anchors and building your palette batch."}
					</p>
					{initialPaletteError && (
						<button
							type="button"
							className="toolbar-button primary"
							onClick={handleRetryInitialPalettes}
						>
							Retry
						</button>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className={`app-shell app-shell-${viewState}`}>
			<header
				className={`app-header ${viewState === "workspace" && isToolbarCollapsed ? "collapsed" : ""}`}
			>
				<div className="app-brand">
					<span className="app-logo" aria-hidden="true">
						<span />
					</span>
					<div>
						<h1>Palette Explorer</h1>
						{viewState !== "workspace" && (
							<p>
								Upload a screenshot, compare generated versions, then explore
								palettes live.
							</p>
						)}
					</div>
				</div>

				<div className="app-header-actions">
					{viewState === "variant" && (
						<span className="step-indicator">Step 1 of 2</span>
					)}

					{viewState === "workspace" && !isToolbarCollapsed && (
						<>
							<div
								className="preview-toggle toolbar-preview-toggle"
								role="group"
								aria-label="Preview size"
							>
								<button
									type="button"
									className={previewMode === "mobile" ? "active" : ""}
									onClick={() => setPreviewMode("mobile")}
									aria-pressed={previewMode === "mobile"}
								>
									<i className="ti ti-device-mobile" aria-hidden="true" />
									Mobile
								</button>
								<button
									type="button"
									className={previewMode === "desktop" ? "active" : ""}
									onClick={() => setPreviewMode("desktop")}
									aria-pressed={previewMode === "desktop"}
								>
									<i className="ti ti-device-desktop" aria-hidden="true" />
									Desktop
								</button>
							</div>

							<button
								type="button"
								className="toolbar-button"
								onClick={handleResetColors}
							>
								<i className="ti ti-refresh" aria-hidden="true" />
								Reset Colors
							</button>

							<button
								type="button"
								className="toolbar-button primary"
								onClick={handleStartOver}
							>
								<i className="ti ti-upload" aria-hidden="true" />
								New Screenshot
							</button>
						</>
					)}
				</div>

				{viewState === "workspace" && (
					<button
						type="button"
						className="toolbar-collapse-button"
						onClick={() => setIsToolbarCollapsed((current) => !current)}
						aria-label={
							isToolbarCollapsed ? "Expand toolbar" : "Collapse toolbar"
						}
						aria-expanded={!isToolbarCollapsed}
					>
						<i
							className={`ti ${isToolbarCollapsed ? "ti-chevron-right" : "ti-chevron-left"}`}
							aria-hidden="true"
						/>
					</button>
				)}
			</header>

			<div className={`app-body app-body-${viewState}`}>
				<div className={`preview-pane preview-pane-${viewState}`}>
					{viewState === "upload" ? (
						<UploadZone
							onFileSelected={handleFileSelected}
							isProcessing={isProcessing}
							statusMessage={statusMessage}
							progressPercent={analysisProgress}
						/>
					) : viewState === "variant" ? (
						<VariantPicker
							variants={variants}
							selectedVariantId={selectedVariantId}
							recommendedVariantId={recommendedVariantId}
							isGenerating={isProcessing}
							isCategorizing={isCategorizing}
							statusMessage={statusMessage}
							progressPercent={analysisProgress}
							previewMode={previewMode}
							onPreviewModeChange={setPreviewMode}
							onSelectVariant={setSelectedVariantId}
							onUseSelectedVariant={handleUseSelectedVariant}
							onImproveVariant={handleImproveVariant}
							uploadedImage={uploadedImage}
							onFileSelected={handleFileSelected}
							improvingVariantId={improvingVariantId}
							highlightedVariantId={highlightedVariantId}
						/>
					) : (
						<UiPreview
							html={html}
							containerRef={previewRootRef}
							highlightedElement={highlightedElement}
							previewMode={previewMode}
							onPreviewModeChange={setPreviewMode}
							onInventoryChange={setPreviewInventory}
							showToolbar={false}
						/>
					)}

					{error && (
						<div className="error-banner">
							<i className="ti ti-alert-circle" aria-hidden="true" />
							{error}
						</div>
					)}
				</div>

				{viewState === "workspace" && !isColorBrainDrawerOpen && (
					<button
						type="button"
						className="colorbrain-drawer-wedge"
						onMouseEnter={() => setIsColorBrainDrawerOpen(true)}
						onFocus={() => setIsColorBrainDrawerOpen(true)}
						onClick={() => setIsColorBrainDrawerOpen(true)}
						aria-label="Open palette settings"
						aria-expanded={false}
					>
						<span aria-hidden="true" />
					</button>
				)}

				{viewState === "workspace" && isColorBrainDrawerOpen && (
					<aside
						className="colorbrain-drawer"
						aria-label="Palette generation settings"
					>
						<div className="colorbrain-drawer-header">
							<div>
								<span>Palette</span>
								<strong>Generation</strong>
							</div>
							<button
								type="button"
								className="colorbrain-drawer-close"
								onClick={() => setIsColorBrainDrawerOpen(false)}
								aria-label="Close palette settings"
							>
								<i className="ti ti-x" aria-hidden="true" />
							</button>
						</div>
						<ColorBrainControls
							settings={colorBrainSettings}
							palette={effectivePalette}
							isGeneratingMore={isGeneratingMorePalettes}
							generationMessage={paletteGenerationMessage}
							generationStatus={paletteGenerationStatus}
							onChangeSetting={handleColorBrainSettingChange}
							onGenerateMore={handleGenerateMorePalettes}
						/>
					</aside>
				)}

				{viewState === "workspace" && !isPanelDrawerOpen && (
					<button
						type="button"
						className="panel-drawer-wedge"
						onMouseEnter={() => setIsPanelDrawerOpen(true)}
						onFocus={() => setIsPanelDrawerOpen(true)}
						onClick={() => setIsPanelDrawerOpen(true)}
						aria-label="Open role drawer"
						aria-expanded={false}
					>
						<span aria-hidden="true" />
					</button>
				)}

				{viewState === "workspace" && isPanelDrawerOpen && (
					<aside className="panel-pane panel-drawer" aria-label="Role editor">
						<div className="panel-drawer-header">
							<div>
								<span>Role drawer</span>
								<strong>Editable color groups</strong>
							</div>
							<button
								type="button"
								className="panel-drawer-close"
								onClick={() => setIsPanelDrawerOpen(false)}
								aria-label="Close role drawer"
							>
								<i className="ti ti-x" aria-hidden="true" />
							</button>
						</div>
						<div className="panel-section color-panel-section">
							<RoleKanban
								elements={elements}
								inventoryItems={previewInventory}
								customSwatches={resolvedCustomSwatches}
								onChangeRole={handleChangeRole}
								onAddInventoryElement={handleAddInventoryElement}
								onRemoveElement={handleRemoveElement}
								onRenameElement={handleRenameElement}
								onRenameRole={handleRenameCustomSwatch}
								onChangeRoleIntent={handleChangeCustomSwatchIntent}
								onImproveRoleIntent={handleImproveCustomSwatchIntent}
								improvingRoleIntentId={improvingCustomSwatchId}
								canImproveRoleIntent={Boolean(selectedVariantSnapshot)}
								onToggleTextLock={handleToggleTextLock}
								onHover={(id) => {
									setHighlightedInventoryItem(null);
									setHighlightedId(id);
								}}
								onInventoryHover={setHighlightedInventoryItem}
							/>
						</div>
					</aside>
				)}

				{viewState === "workspace" && (
					<SavedPaletteWheel
						savedPalettes={savedPalettes}
						isSaved={isCurrentPaletteSaved}
						currentPaletteSignature={currentPaletteSignature}
						onToggleSavedPalette={handleToggleSavedPalette}
						onApplySavedPalette={handleApplySavedPalette}
					/>
				)}

				{viewState === "workspace" && (
					<section className="palette-dock" aria-label="Palette controls">
						<PaletteStrip
							palette={effectivePalette}
							lockedRoles={lockedRoles}
							customSwatches={resolvedCustomSwatches}
							hiddenSwatches={hiddenSwatches}
							onToggleRoleLock={handleToggleRoleLock}
							onAddSwatch={handleAddSwatch}
							onDeleteSwatch={handleDeleteSwatch}
						/>
					</section>
				)}
			</div>
		</div>
	);
}

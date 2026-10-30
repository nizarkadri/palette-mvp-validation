/**
 * analyzeScreenshot
 * -----------------
 * Browser client for the server-side screenshot pipeline.
 *
 * The current architecture intentionally splits AI work into two stages:
 *  1. screenshot-to-code style generation of high-fidelity static HTML/CSS
 *  2. semantic categorization of stable palette hooks into editable roles
 *
 * Palette cycling, drag/drop, hover highlighting, text locks, and export remain
 * purely local after /api/analyze returns.
 */

export {
	MINIMAX_VALIDATION_PROMPT,
	SCREENSHOT_JSON_GENERATION_PROMPT as SCREENSHOT_TO_CODE_PROMPT,
	SCREENSHOT_JSON_GENERATION_PROMPT as SYSTEM_PROMPT,
	SEMANTIC_CATEGORIZATION_PROMPT,
} from "../prompts/index.js";
import {
	HEX_COLOR_RE,
	MUTATING_ROLES,
	isKnownElementRole,
} from "./constants.js";
import { selectorForId } from "./selectorUtils.js";

export { selectorForId } from "./selectorUtils.js";

/**
 * @typedef {'primary'|'secondary'|'accent'|'custom'} ElementRole
 */

/**
 * @typedef {object} ColorableElement
 * @property {string} id - Stable id for display and compatibility targeting.
 * @property {string} selector - CSS selector scoped to the preview root.
 * @property {string[]} selectors - Preferred grouped selectors for one semantic pill.
 * @property {string} label - Human-readable kanban label.
 * @property {ElementRole} role - Color role intent.
 * @property {string} swatch - Sampled 6-digit hex color.
 * @property {string} rationale - Short reason for the categorization.
 * @property {boolean} isText - Whether this element should be treated as text.
 * @property {boolean} textLocked - Whether text should stay auto-contrast/readable.
 * @property {'ai'|'manual'|'manual-inventory'} source - Origin of this element record.
 * @property {string} inventoryId - Runtime preview inventory id for manual inventory overrides.
 * @property {boolean} isManual - Backward-compatible manual-origin flag.
 */

const MANUAL_ELEMENT_SOURCES = new Set(["manual", "manual-inventory"]);

const TEXT_CLASS_RE =
	/(?:text|title|heading|caption|label|link|price|stat|copy|paragraph|input|nav|tab|button|username|role|time|save|body|content|amount)/i;

function idFromSelector(selector) {
	if (typeof selector !== "string") return "";
	const attrMatch = selector.match(
		/\[(?:data-palette-id|data-el)=['"]?([^'"\]]+)['"]?\]/i,
	);
	if (attrMatch) return attrMatch[1];
	const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/);
	return classMatch?.[1] || "";
}

/**
 * Normalize AI/manual colorable elements into the app's full element model.
 * Keeps old `{ id, role }` responses usable while enabling selector-based
 * `data-palette-id` records and the Custom tray.
 *
 * @param {Partial<ColorableElement>} element
 * @returns {ColorableElement}
 */
export function normalizeElement(element = {}) {
	const rawSelectors = Array.isArray(element.selectors)
		? element.selectors
				.filter((selector) => typeof selector === "string")
				.map((selector) => selector.trim())
				.filter(Boolean)
		: [];
	const explicitSelector =
		typeof element.selector === "string" && element.selector.trim()
			? element.selector.trim()
			: "";
	const selectors = rawSelectors.length
		? rawSelectors
		: explicitSelector
			? [explicitSelector]
			: [];
	const rawId =
		typeof element.id === "string" && element.id.trim()
			? element.id.trim()
			: idFromSelector(selectors[0] || explicitSelector);
	const id = rawId || String(element.id ?? "").trim();
	const normalizedSelectors = selectors.length
		? selectors
		: [selectorForId(id)];
	const selector = explicitSelector || normalizedSelectors.join(", ");
	const inferredIsText = TEXT_CLASS_RE.test(`${id} ${element.label || ""}`);
	const isText =
		typeof element.isText === "boolean" ? element.isText : inferredIsText;
	const legacyRole = element.role === "uncategorized" ? "custom" : element.role;
	const role = isKnownElementRole(legacyRole) ? legacyRole : "custom";
	let source = "ai";
	if (MANUAL_ELEMENT_SOURCES.has(element.source)) {
		source = element.source;
	} else if (element.isManual) {
		source = "manual";
	}

	return {
		id,
		selector,
		selectors: normalizedSelectors,
		label:
			typeof element.label === "string" && element.label.trim()
				? element.label.trim()
				: id,
		role,
		swatch: HEX_COLOR_RE.test(element.swatch) ? element.swatch : "#888888",
		rationale:
			typeof element.rationale === "string" ? element.rationale.trim() : "",
		isText,
		textLocked:
			typeof element.textLocked === "boolean" ? element.textLocked : isText,
		source,
		inventoryId:
			typeof element.inventoryId === "string" ? element.inventoryId.trim() : "",
		kind: typeof element.kind === "string" ? element.kind.trim() : "",
		groupLabel:
			typeof element.groupLabel === "string" ? element.groupLabel.trim() : "",
		paletteId:
			typeof element.paletteId === "string" ? element.paletteId.trim() : "",
		dataEl: typeof element.dataEl === "string" ? element.dataEl.trim() : "",
		text: typeof element.text === "string" ? element.text.trim() : "",
		isManual: source !== "ai",
	};
}

function normalizeElements(elements = []) {
	return elements
		.map((element) => normalizeElement(element))
		.filter((el) => el.id);
}

function selectorExistsInHtml(element, html) {
	if (typeof DOMParser === "undefined") return true;
	if (element.id === "app-bg") return true;

	const parsedDocument = new DOMParser().parseFromString(html, "text/html");
	const selectors = Array.isArray(element.selectors)
		? element.selectors
		: element.selector
			? [element.selector]
			: [];

	for (const selector of selectors) {
		try {
			if (selector && parsedDocument.querySelector(selector)) return true;
		} catch {
			// Try the next grouped selector, then fall back to id compatibility.
		}
	}

	try {
		return Boolean(parsedDocument.querySelector(selectorForId(element.id)));
	} catch {
		return false;
	}
}

function filterElementsWithHtmlTargets(elements, html) {
	const validElements = [];
	const missingElements = [];
	const seen = new Set();

	elements.forEach((element) => {
		if (seen.has(element.id)) return;
		seen.add(element.id);

		if (selectorExistsInHtml(element, html)) {
			validElements.push(element);
		} else {
			missingElements.push(
				element.selector || element.id || "(missing selector)",
			);
		}
	});

	if (missingElements.length > 0) {
		console.warn(
			"AI returned element selectors that do not match the generated HTML:",
			missingElements,
		);
	}

	return validElements;
}

export function upsertVariantByIndex(variants, variant) {
	return [
		...variants.filter(
			(existing) =>
				existing.id !== variant.id && existing.index !== variant.index,
		),
		variant,
	].sort((a, b) => a.index - b.index);
}

/**
 * @param {string} base64Image - base64-encoded image data (no data: prefix)
 * @param {string} mediaType - e.g. "image/png" or "image/jpeg"
 * @returns {Promise<{html: string, elements: ColorableElement[], debug?: object}>}
 */
export async function analyzeScreenshotVariants(
	base64Image,
	mediaType = "image/png",
	handlers = {},
) {
	const response = await fetch("/api/analyze-stream", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ base64: base64Image, mediaType }),
	});

	if (!response.ok || !response.body) {
		let message = `Analysis stream failed: ${response.status}`;
		try {
			const parsed = await response.json();
			if (parsed?.error) message = parsed.error;
		} catch {
			// Keep the status-based error.
		}
		throw new Error(message);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const variants = [];
	const failedVariants = [];
	const evaluatedVariantIds = [];
	let buffer = "";
	let complete = null;
	let completeCount = 0;

	function handleEvent(event) {
		if (complete) {
			throw new Error(
				"Analysis stream completed without exactly three evaluated variants.",
			);
		}
		if (event.type === "progress") handlers.onProgress?.(event);
		if (event.type === "variant.generated") {
			const variant = { ...event.variant, elements: [] };
			const hasValidIdentity =
				Number.isInteger(variant.index) &&
				variant.index >= 1 &&
				variant.index <= 3 &&
				variant.id === `variant-${variant.index}`;
			const isDuplicate = variants.some(
				(existing) =>
					existing.id === variant.id || existing.index === variant.index,
			);
			if (!hasValidIdentity || isDuplicate) {
				throw new Error(
					"Analysis stream completed without exactly three evaluated variants.",
				);
			}
			variants.push(variant);
			handlers.onVariant?.(variant);
		}
		if (event.type === "variant.evaluated") {
			if (!variants.some((variant) => variant.id === event.variantId)) {
				throw new Error(
					"Analysis stream evaluated a variant before generation.",
				);
			}
			if (evaluatedVariantIds.includes(event.variantId)) {
				throw new Error(
					"Analysis stream completed without exactly three evaluated variants.",
				);
			}
			evaluatedVariantIds.push(event.variantId);
			handlers.onVariantEvaluated?.(event);
		}
		if (event.type === "variant.failed") {
			failedVariants.push(event);
			handlers.onVariantFailed?.(event);
		}
		if (event.type === "complete") {
			complete = event;
			completeCount += 1;
		}
		if (event.type === "error") {
			throw new Error(event.error || "Analysis failed.");
		}
	}

	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				handleEvent(JSON.parse(line));
			} catch (parseError) {
				throw new Error(
					parseError instanceof SyntaxError
						? "Analysis stream failed: invalid server event."
						: parseError.message || "Analysis failed.",
				);
			}
		}
	}

	if (buffer.trim()) {
		try {
			handleEvent(JSON.parse(buffer));
		} catch (parseError) {
			throw new Error(
				parseError instanceof SyntaxError
					? "Analysis stream failed: invalid server event."
					: parseError.message || "Analysis failed.",
			);
		}
	}

	if (!complete) {
		throw new Error("Analysis stream ended before terminal complete.");
	}

	const variantIndexes = variants.map((variant) => variant.index);
	const variantIds = variants.map((variant) => variant.id);
	const uniqueIndexes = new Set(variantIndexes);
	const uniqueVariantIds = new Set(variantIds);
	const uniqueEvaluatedIds = new Set(evaluatedVariantIds);
	const hasExpectedIndexes = [1, 2, 3].every((index) =>
		uniqueIndexes.has(index),
	);
	const hasExactlyThreeEvaluatedVariants =
		evaluatedVariantIds.length === 3 &&
		uniqueEvaluatedIds.size === 3 &&
		evaluatedVariantIds.every((variantId) => uniqueVariantIds.has(variantId));
	const hasCompleteTerminalContract =
		completeCount === 1 &&
		failedVariants.length === 0 &&
		variants.length === 3 &&
		uniqueIndexes.size === 3 &&
		uniqueVariantIds.size === 3 &&
		hasExpectedIndexes &&
		hasExactlyThreeEvaluatedVariants &&
		uniqueVariantIds.has(complete.recommendedVariantId);

	if (!hasCompleteTerminalContract) {
		throw new Error(
			"Analysis stream completed without exactly three evaluated variants.",
		);
	}

	const sortedVariants = [...variants].sort((a, b) => a.index - b.index);
	handlers.onComplete?.(complete);

	return {
		variants: sortedVariants,
		failedVariants,
		recommendedVariantId: complete.recommendedVariantId,
		debug: complete.debug,
	};
}

export async function categorizeSelectedVariant({
	html,
	base64,
	mediaType = "image/png",
	variantId,
}) {
	const response = await fetch("/api/categorize", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ html, base64, mediaType, variantId }),
	});

	let parsed;
	try {
		parsed = await response.json();
	} catch {
		throw new Error("Categorization failed: invalid server response.");
	}

	if (!response.ok) {
		throw new Error(
			parsed?.error || `Categorization failed: ${response.status}`,
		);
	}

	if (!parsed.html || !Array.isArray(parsed.elements)) {
		throw new Error(
			'Categorization response missing required "html" or "elements" fields',
		);
	}

	return {
		...parsed,
		elements: filterElementsWithHtmlTargets(
			normalizeElements(parsed.elements),
			parsed.html,
		),
	};
}

export async function analyzeCustomSwatchVisualFit({
	base64,
	mediaType = "image/png",
	swatch,
	elements,
	palette,
}) {
	const response = await fetch("/api/custom-swatch/analyze", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ base64, mediaType, swatch, elements, palette }),
	});

	let parsed;
	try {
		parsed = await response.json();
	} catch {
		throw new Error("Custom swatch analysis failed: invalid server response.");
	}

	if (!response.ok) {
		throw new Error(
			parsed?.error || `Custom swatch analysis failed: ${response.status}`,
		);
	}

	return parsed;
}

export async function improveVariant({
	html,
	base64,
	mediaType = "image/png",
	variantId,
	modelId,
}) {
	const response = await fetch("/api/improve-variant", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ html, base64, mediaType, variantId, modelId }),
	});

	let parsed;
	try {
		parsed = await response.json();
	} catch {
		throw new Error("Variant improvement failed: invalid server response.");
	}

	if (!response.ok) {
		throw new Error(
			parsed?.error || `Variant improvement failed: ${response.status}`,
		);
	}

	if (!parsed.html) {
		throw new Error(
			'Variant improvement response missing required "html" field',
		);
	}

	return parsed;
}

export async function analyzeScreenshot(base64Image, mediaType = "image/png") {
	const response = await fetch("/api/analyze", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ base64: base64Image, mediaType }),
	});

	let parsed;
	try {
		parsed = await response.json();
	} catch {
		throw new Error("Analysis failed: invalid server response.");
	}

	if (!response.ok) {
		throw new Error(parsed.error || `Analysis failed: ${response.status}`);
	}

	if (!parsed.html || !Array.isArray(parsed.elements)) {
		throw new Error(
			'Analysis response missing required "html" or "elements" fields',
		);
	}

	return {
		...parsed,
		elements: filterElementsWithHtmlTargets(
			normalizeElements(parsed.elements),
			parsed.html,
		),
	};
}

/**
 * Helper: convert a File object to a base64 string (no data: prefix)
 */
export function fileToBase64(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result;
			const base64 = result.split(",")[1];
			resolve(base64);
		};
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

export function isPaletteMutatingRole(role) {
	return MUTATING_ROLES.has(role);
}

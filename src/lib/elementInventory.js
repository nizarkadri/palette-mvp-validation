import { cssEscape } from "./selectorUtils.js";

export const INVENTORY_ID_ATTRIBUTE = "data-pe-inventory-id";

const DEFAULT_MAX_ITEMS = 180;
const DEFAULT_MAX_SCAN_NODES = 900;
const MIN_VISIBLE_AREA = 48;
const SKIPPED_TAGS = new Set([
	"HTML",
	"BODY",
	"HEAD",
	"SCRIPT",
	"STYLE",
	"META",
	"LINK",
	"TITLE",
	"NOSCRIPT",
	"TEMPLATE",
]);
const TEXT_TAGS = new Set([
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"P",
	"SPAN",
	"LABEL",
	"STRONG",
	"EM",
	"SMALL",
]);
const SECTION_TAGS = new Set([
	"ARTICLE",
	"ASIDE",
	"HEADER",
	"FOOTER",
	"MAIN",
	"NAV",
	"SECTION",
]);
const HEX_COLOR_RE = /^#[\da-f]{6}$/i;
const KIND_GROUPS = {
	button: "Buttons",
	link: "Links",
	input: "Inputs",
	icon: "Icons",
	title: "Titles",
	text: "Text",
	image: "Images",
	card: "Cards",
	section: "Sections",
	surface: "Surfaces",
	element: "Other elements",
};
const KIND_LABELS = {
	button: "Button",
	link: "Link",
	input: "Input",
	icon: "Icon",
	title: "Title",
	text: "Text",
	image: "Image",
	card: "Card",
	section: "Section",
	surface: "Surface",
	element: "Element",
};
const REDUNDANT_CONTAINER_KINDS = new Set(["surface"]);

function normalizePositiveInteger(value, fallback) {
	return Number.isInteger(value) && value > 0 ? value : fallback;
}

function getTagName(element) {
	return String(element?.tagName || "").toUpperCase();
}

function normalizeText(value, maxLength = 56) {
	const text = String(value || "")
		.replace(/\s+/g, " ")
		.trim();
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 1).trim()}…`;
}

function cssColorToHex(color, fallback = "#888888") {
	if (typeof color !== "string") return fallback;
	const trimmed = color.trim();
	if (HEX_COLOR_RE.test(trimmed)) return trimmed.toLowerCase();

	const match = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
	if (!match) return fallback;

	return [match[1], match[2], match[3]]
		.map((channel) =>
			Math.max(0, Math.min(255, Number(channel)))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")
		.replace(/^/, "#");
}

function getComputedStyleForElement(element) {
	return element.ownerDocument?.defaultView?.getComputedStyle(element) || null;
}

function isTransparentColor(color) {
	return (
		!color ||
		color === "transparent" ||
		color === "rgba(0, 0, 0, 0)" ||
		color === "rgba(0,0,0,0)"
	);
}

function hasVisibleBorder(computedStyle) {
	if (!computedStyle || computedStyle.borderStyle === "none") return false;
	return [
		computedStyle.borderTopWidth,
		computedStyle.borderRightWidth,
		computedStyle.borderBottomWidth,
		computedStyle.borderLeftWidth,
	].some((width) => Number.parseFloat(width) > 0);
}

function getElementArea(element) {
	const rect = element.getBoundingClientRect?.();
	const rectArea = Math.round((rect?.width || 0) * (rect?.height || 0));
	const fallbackArea = Math.round(
		(element.offsetWidth || element.scrollWidth || 0) *
			(element.offsetHeight || element.scrollHeight || 0),
	);
	return Math.max(rectArea, fallbackArea);
}

function hasZeroOpacity(computedStyle) {
	return computedStyle?.opacity !== "" && Number(computedStyle?.opacity) === 0;
}

function isHiddenByOwnStyle(computedStyle) {
	return (
		!computedStyle ||
		computedStyle.display === "none" ||
		computedStyle.visibility === "hidden" ||
		hasZeroOpacity(computedStyle)
	);
}

function hasHiddenAncestor(element) {
	let parent = element.parentElement;
	while (parent && !SKIPPED_TAGS.has(getTagName(parent))) {
		if (isHiddenByOwnStyle(getComputedStyleForElement(parent))) return true;
		parent = parent.parentElement;
	}
	return false;
}

function isVisibleCandidate(element, computedStyle) {
	if (isHiddenByOwnStyle(computedStyle) || hasHiddenAncestor(element)) {
		return false;
	}

	const area = getElementArea(element);
	const hasText = normalizeText(element.textContent, 24).length > 0;
	const isSemanticMedia = ["IMG", "SVG", "I"].includes(getTagName(element));
	return area >= MIN_VISIBLE_AREA || hasText || isSemanticMedia;
}

function isTextLikeCandidate(element, computedStyle) {
	if (!computedStyle) return false;
	const hasText = normalizeText(element.textContent, 24).length > 0;
	if (!hasText) return false;
	const hasBlockChildren = Array.from(element.children).some(
		(child) =>
			!["SPAN", "I", "B", "STRONG", "EM", "SMALL"].includes(getTagName(child)),
	);
	return TEXT_TAGS.has(element.tagName) || !hasBlockChildren;
}

function inferKind(element, computedStyle) {
	const tagName = getTagName(element);
	const role = element.getAttribute("role") || "";
	const className = String(element.getAttribute("class") || "");
	const text = normalizeText(element.textContent, 32);

	if (
		tagName === "BUTTON" ||
		role === "button" ||
		/\b(btn|button|cta)\b/i.test(className)
	) {
		return "button";
	}
	if (tagName === "A") return "link";
	if (["INPUT", "SELECT", "TEXTAREA"].includes(tagName)) return "input";
	if (tagName === "IMG" || element.getAttribute("role") === "img")
		return "image";
	if (tagName === "SVG" || tagName === "I" || /\b(icon)\b/i.test(className)) {
		return "icon";
	}
	if (/^H[1-6]$/.test(tagName)) return "title";
	if (/\b(card|panel|tile|item|post|product|plan|surface)\b/i.test(className)) {
		return "card";
	}
	if (SECTION_TAGS.has(tagName)) return "section";
	if (isTextLikeCandidate(element, computedStyle) && text) return "text";
	if (
		!isTransparentColor(computedStyle?.backgroundColor) ||
		hasVisibleBorder(computedStyle)
	) {
		return "surface";
	}
	return "element";
}

function getKindScore(kind) {
	return (
		{
			button: 110,
			link: 104,
			input: 104,
			icon: 100,
			title: 96,
			image: 92,
			text: 82,
			card: 74,
			section: 62,
			surface: 54,
			element: 20,
		}[kind] || 0
	);
}

function getElementLabel(element, kind) {
	const explicitLabel =
		element.getAttribute("aria-label") ||
		element.getAttribute("alt") ||
		element.getAttribute("title") ||
		"";
	const text = normalizeText(explicitLabel || element.textContent, 44);
	const paletteId = element.getAttribute("data-palette-id");
	const dataEl = element.getAttribute("data-el");
	const hook = paletteId || dataEl;
	const labelBase =
		text || hook || element.id || normalizeText(element.className, 32);
	const readableKind = KIND_LABELS[kind] || KIND_LABELS.element;
	return labelBase ? `${readableKind}: ${labelBase}` : readableKind;
}

function sampleElementSwatch(element, computedStyle, isText) {
	if (!computedStyle) return "#888888";
	const color =
		isText || ["SVG", "I"].includes(getTagName(element))
			? computedStyle.color
			: computedStyle.backgroundColor;
	return cssColorToHex(color);
}

function shouldIncludeCandidate(element, computedStyle, kind) {
	if (SKIPPED_TAGS.has(getTagName(element))) return false;
	if (!isVisibleCandidate(element, computedStyle)) return false;
	if (kind === "element") return false;

	const hasPaletteHook =
		element.hasAttribute("data-palette-id") || element.hasAttribute("data-el");
	const hasText = normalizeText(element.textContent, 24).length > 0;
	const hasVisualSurface =
		!isTransparentColor(computedStyle?.backgroundColor) ||
		hasVisibleBorder(computedStyle);
	return (
		hasPaletteHook ||
		hasText ||
		hasVisualSurface ||
		["image", "icon", "input"].includes(kind)
	);
}

function hasSelectedAncestor(element, selectedNodes) {
	let parent = element.parentElement;
	while (parent) {
		if (selectedNodes.has(parent)) return true;
		parent = parent.parentElement;
	}
	return false;
}

function createInventoryItem(element, inventoryId, kind, computedStyle) {
	const isText = isTextLikeCandidate(element, computedStyle);
	const paletteId = element.getAttribute("data-palette-id") || "";
	const dataEl = element.getAttribute("data-el") || "";
	return {
		id: inventoryId,
		inventoryId,
		selector: `[${INVENTORY_ID_ATTRIBUTE}="${cssEscape(inventoryId)}"]`,
		label: getElementLabel(element, kind),
		kind,
		groupLabel: KIND_GROUPS[kind] || KIND_GROUPS.element,
		tagName: element.tagName.toLowerCase(),
		text: normalizeText(element.textContent, 96),
		swatch: sampleElementSwatch(element, computedStyle, isText),
		isText,
		paletteId,
		dataEl,
	};
}

export function clearElementInventoryMarkers(root) {
	if (!root?.querySelectorAll) return;
	root.querySelectorAll(`[${INVENTORY_ID_ATTRIBUTE}]`).forEach((element) => {
		element.removeAttribute(INVENTORY_ID_ATTRIBUTE);
	});
	root.removeAttribute?.(INVENTORY_ID_ATTRIBUTE);
}

export function stripElementInventoryMarkersFromHtml(html) {
	return String(html || "").replace(
		/\sdata-pe-inventory-id=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
		"",
	);
}

export function buildElementInventory(root, options = {}) {
	if (!root?.querySelectorAll) return [];

	const maxItems = normalizePositiveInteger(
		options.maxItems,
		DEFAULT_MAX_ITEMS,
	);
	const maxScanNodes = normalizePositiveInteger(
		options.maxScanNodes,
		DEFAULT_MAX_SCAN_NODES,
	);
	clearElementInventoryMarkers(root);

	const candidates = [];
	const nodes = Array.from(root.querySelectorAll("*")).slice(0, maxScanNodes);
	nodes.forEach((element, domIndex) => {
		const computedStyle = getComputedStyleForElement(element);
		const kind = inferKind(element, computedStyle);
		if (!shouldIncludeCandidate(element, computedStyle, kind)) return;

		const score =
			getKindScore(kind) + (element.hasAttribute("data-palette-id") ? 10 : 0);
		candidates.push({ element, computedStyle, domIndex, kind, score });
	});

	const selectedNodes = new Set();
	const selected = candidates
		.sort(
			(left, right) =>
				right.score - left.score || left.domIndex - right.domIndex,
		)
		.filter(({ element, kind }) => {
			if (
				REDUNDANT_CONTAINER_KINDS.has(kind) &&
				hasSelectedAncestor(element, selectedNodes)
			) {
				return false;
			}
			selectedNodes.add(element);
			return true;
		})
		.slice(0, maxItems)
		.sort((left, right) => left.domIndex - right.domIndex);

	return selected.map(({ element, kind, computedStyle }, index) => {
		const inventoryId = `pe-${index + 1}`;
		element.setAttribute(INVENTORY_ID_ATTRIBUTE, inventoryId);
		return createInventoryItem(element, inventoryId, kind, computedStyle);
	});
}

/**
 * applyPaletteToElements
 * -----------------------
 * Given semantic elements and a palette, sets inline CSS custom properties and
 * scoped inline styles on matching preview nodes so recoloring is instant.
 *
 * Modern elements target `element.selector` (usually data-palette-id). Older
 * records with only `id` still target `[data-el]` / class names for backwards
 * compatibility. The Exclude role is intentionally skipped; user-added custom
 * swatch roles are applied using their swatch color.
 */

import { HEX_COLOR_RE, MUTATING_ROLES } from "./constants.js";
import { hexToRgb, relativeLuminance } from "./colorBrain/contrast.js";
import { selectorForId } from "./selectorUtils.js";

export { hexToRgb, relativeLuminance };

const DEFAULT_TEXT_DARK = "#111827";
const DEFAULT_TEXT_LIGHT = "#ffffff";

export function isLightPalette(palette) {
	return relativeLuminance(palette?.primary) > 0.5;
}

export function getAutoTextColor(palette) {
	return isLightPalette(palette) ? DEFAULT_TEXT_DARK : DEFAULT_TEXT_LIGHT;
}

function getCustomSwatchForRole(role, palette) {
	return Array.isArray(palette?.customSwatches)
		? palette.customSwatches.find((swatch) => swatch.id === role) || null
		: null;
}

export function getRoleColor(role, palette) {
	if (role === "primary") return palette?.primary || "#888888";
	if (role === "accent") return palette?.accent || "#888888";
	if (role === "secondary") return palette?.secondary || "#888888";
	const customSwatch = getCustomSwatchForRole(role, palette);
	return customSwatch?.color || customSwatch?.tokens?.background || "#888888";
}

function isMutatingRole(role, palette) {
	if (MUTATING_ROLES.has(role)) return true;
	return Array.isArray(palette?.customSwatches)
		? palette.customSwatches.some((swatch) => swatch.id === role)
		: false;
}

export function getEffectivePalette(palette) {
	return {
		...palette,
		text: palette?.text || getAutoTextColor(palette),
		textMuted: palette?.textMuted || getAutoTextColor(palette),
		onAccent:
			palette?.onAccent || getAutoTextColor({ primary: palette?.accent }),
	};
}

const textLikeCache = new WeakMap();

export function detectIsTextLike(el) {
	if (!el || typeof window === "undefined") return false;
	if (textLikeCache.has(el)) return textLikeCache.get(el);

	const computed = window.getComputedStyle(el);
	const bg = computed.backgroundColor;
	const isTransparent =
		bg === "transparent" || bg === "rgba(0, 0, 0, 0)" || bg === "";
	const hasOnlyTextOrInline =
		el.children.length === 0 ||
		Array.from(el.children).every((c) =>
			["SPAN", "I", "B", "STRONG", "EM"].includes(c.tagName),
		);
	const result = isTransparent && hasOnlyTextOrInline;
	textLikeCache.set(el, result);
	return result;
}

function cssColorToHex(color, fallback = "#888888") {
	if (typeof color !== "string") return fallback;
	if (HEX_COLOR_RE.test(color.trim())) return color.trim();

	const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
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

export function sampleElementSwatch(el) {
	if (!el || typeof window === "undefined") return "#888888";

	const computed = window.getComputedStyle(el);
	const sampledColor =
		detectIsTextLike(el) || isSvgIconTarget(el)
			? computed.color
			: computed.backgroundColor;

	return cssColorToHex(sampledColor);
}

function isTransparentCssColor(color) {
	return (
		!color ||
		color === "transparent" ||
		color === "rgba(0, 0, 0, 0)" ||
		/^rgba\([^)]*,\s*0\)$/i.test(color)
	);
}

function hasVisibleBorder(computed) {
	return ["Top", "Right", "Bottom", "Left"].some((side) => {
		const width = Number.parseFloat(computed[`border${side}Width`]);
		const style = computed[`border${side}Style`];
		return width > 0 && style !== "none" && style !== "hidden";
	});
}

function isSvgElement(el) {
	return el?.tagName?.toLowerCase() === "svg";
}

function isSvgIconTarget(el) {
	if (!el) return false;
	return isSvgElement(el) || Boolean(el.querySelector?.("svg"));
}

function paintSvgIcon(svg, color) {
	svg.style.color = color;
	svg.style.fill = color;
	svg.style.stroke = color;

	svg
		.querySelectorAll("path, circle, rect, line, polyline, polygon, ellipse")
		.forEach((shape) => {
			const fill = shape.getAttribute("fill");
			const stroke = shape.getAttribute("stroke");

			if (fill && fill.toLowerCase() !== "none") {
				shape.style.fill = color;
			}
			if (stroke && stroke.toLowerCase() !== "none") {
				shape.style.stroke = color;
			}
			if (!fill && !stroke) {
				shape.style.fill = color;
			}
		});
}

function paintSvgIcons(el, color) {
	if (isSvgElement(el)) paintSvgIcon(el, color);
	el.querySelectorAll?.("svg").forEach((svg) => paintSvgIcon(svg, color));
}

function resetSvgIcon(svg) {
	svg.style.color = "";
	svg.style.fill = "";
	svg.style.stroke = "";
	svg
		.querySelectorAll("path, circle, rect, line, polyline, polygon, ellipse")
		.forEach((shape) => {
			shape.style.fill = "";
			shape.style.stroke = "";
		});
}

function resetSvgIcons(el) {
	if (isSvgElement(el)) resetSvgIcon(el);
	el.querySelectorAll?.("svg").forEach((svg) => resetSvgIcon(svg));
}

export function getElementMatches(element, root) {
	if (!root || !element) return [];

	const selectors = [];
	if (Array.isArray(element.selectors)) {
		element.selectors
			.filter((selector) => typeof selector === "string" && selector.trim())
			.forEach((selector) => selectors.push(selector.trim()));
	}
	if (typeof element.selector === "string" && element.selector.trim()) {
		selectors.push(element.selector.trim());
	}
	if (element.id) selectors.push(selectorForId(element.id));

	const seenSelectors = new Set();
	const seenNodes = new Set();
	const matches = [];
	selectors.forEach((selector) => {
		if (seenSelectors.has(selector)) return;
		seenSelectors.add(selector);
		try {
			if (root.matches?.(selector) && !seenNodes.has(root)) {
				seenNodes.add(root);
				matches.push(root);
			}
			root.querySelectorAll(selector).forEach((node) => {
				if (!seenNodes.has(node)) {
					seenNodes.add(node);
					matches.push(node);
				}
			});
		} catch (error) {
			console.warn(`Invalid element selector skipped: ${selector}`, error);
		}
	});

	return matches;
}

function getPaletteApplicationPriority(element) {
	if (element?.source === "manual-inventory") return 2;
	if (element?.source === "manual" || element?.isManual) return 1;
	return 0;
}

function orderElementsForPaletteApplication(elements) {
	return [...elements].sort((left, right) => {
		return (
			getPaletteApplicationPriority(left) - getPaletteApplicationPriority(right)
		);
	});
}

function applyCustomSwatchToElement({
	el,
	element,
	swatch,
	effectivePalette,
	isTextElement,
	isIconTarget,
	originallyTransparent,
	originallyBordered,
}) {
	const tokens = swatch.tokens || {};
	const roleColor = swatch.color || tokens.background || "#888888";
	const background = tokens.background || roleColor;
	const border = tokens.border || roleColor;
	const text = tokens.text || effectivePalette.text;
	const icon = tokens.icon || roleColor;
	const mode = swatch.applicationMode || "smartDefault";

	if (mode === "textOnly") {
		el.style.backgroundColor = "transparent";
		el.style.borderColor = "";
		el.style.color = text;
		if (isIconTarget) paintSvgIcons(el, text);
		return;
	}

	if (mode === "iconOnly") {
		el.style.backgroundColor = "transparent";
		el.style.borderColor = "";
		el.style.color = icon;
		paintSvgIcons(el, icon);
		return;
	}

	if (isTextElement) {
		el.style.backgroundColor = "transparent";
		el.style.borderColor = "";
		el.style.color = element.textLocked === false ? roleColor : text;
		if (isIconTarget) paintSvgIcons(el, el.style.color || icon);
		return;
	}

	if (isIconTarget) {
		el.style.backgroundColor = "transparent";
		el.style.borderColor = "";
		el.style.color = icon;
		paintSvgIcons(el, icon);
		return;
	}

	if (mode === "solidFill") {
		el.style.backgroundColor = background;
		el.style.borderColor = border;
		el.style.color = text;
		paintSvgIcons(el, text);
		return;
	}

	if (originallyTransparent && !originallyBordered) {
		el.style.backgroundColor = "transparent";
		el.style.color = icon;
		paintSvgIcons(el, icon);
		return;
	}

	el.style.backgroundColor = background;
	el.style.borderColor = border;
	el.style.color = text;
}

/**
 * @param {Array<{id: string, selector?: string, role: string}>} elements
 * @param {object} palette - one entry from PALETTES
 * @param {HTMLElement} root - the container element holding the recreated HTML
 */
export function applyPaletteToElements(elements, palette, root) {
	if (!root) return;

	const effectivePalette = getEffectivePalette(palette);
	root.style.setProperty("--fin-bg", effectivePalette.primary);
	root.style.backgroundColor = effectivePalette.primary;
	root.ownerDocument?.documentElement?.style.setProperty(
		"background-color",
		effectivePalette.primary,
	);
	root.style.setProperty("--fin-card", effectivePalette.secondary);
	root.style.setProperty("--fin-accent", effectivePalette.accent);
	root.style.setProperty("--fin-heading", effectivePalette.text);
	root.style.setProperty("--fin-muted", effectivePalette.textMuted);
	root.style.setProperty("--fin-avatar", effectivePalette.accent);

	orderElementsForPaletteApplication(elements).forEach((element) => {
		const { role = "secondary" } = element;
		if (!isMutatingRole(role, effectivePalette)) return;

		getElementMatches(element, root).forEach((el) => {
			const originalComputed = window.getComputedStyle(el);
			const originallyTransparent = isTransparentCssColor(
				originalComputed.backgroundColor,
			);
			const originallyBordered = hasVisibleBorder(originalComputed);
			const hasTextMetadata =
				element._hasTextMetadata !== false &&
				typeof element.isText === "boolean";
			const isTextElement = hasTextMetadata
				? element.isText
				: detectIsTextLike(el);
			const customSwatch = getCustomSwatchForRole(role, effectivePalette);
			const roleColor = getRoleColor(role, effectivePalette);
			const dataEl = el.getAttribute("data-el");
			const paletteId = el.getAttribute("data-palette-id");
			const hook = paletteId || dataEl || element.id;
			const isIconTarget = isSvgIconTarget(el);

			el.style.backgroundColor = "";
			el.style.color = "";
			resetSvgIcons(el);

			if (customSwatch) {
				applyCustomSwatchToElement({
					el,
					element,
					swatch: customSwatch,
					effectivePalette,
					isTextElement,
					isIconTarget,
					originallyTransparent,
					originallyBordered,
				});
			} else if (hook === "app-bg") {
				el.style.backgroundColor = effectivePalette.primary;
				el.style.color = effectivePalette.text;
			} else if (hook === "heading") {
				el.style.color = effectivePalette.text;
			} else if (hook === "muted-text") {
				el.style.color = effectivePalette.textMuted;
			} else if (hook === "card-surface" || hook === "input-surface") {
				el.style.backgroundColor = effectivePalette.secondary;
				el.style.color = effectivePalette.text;
			} else if (hook === "primary-cta") {
				el.style.backgroundColor = effectivePalette.accent;
				el.style.color = effectivePalette.onAccent;
				paintSvgIcons(el, effectivePalette.onAccent);
			} else if (hook === "accent-element" || hook === "action-icon") {
				el.style.color = effectivePalette.accent;
				paintSvgIcons(el, effectivePalette.accent);
			} else if (hook === "avatar") {
				el.style.backgroundColor = effectivePalette.accent;
				el.style.color = effectivePalette.onAccent;
			} else if (role === "primary" && !isTextElement) {
				el.style.backgroundColor = effectivePalette.primary;
				el.style.color = effectivePalette.text;
				paintSvgIcons(el, effectivePalette.text);
			} else if (isTextElement) {
				el.style.backgroundColor = "transparent";
				el.style.borderColor = "";
				el.style.color =
					element.textLocked === false ? roleColor : effectivePalette.text;
				if (isIconTarget) paintSvgIcons(el, el.style.color || roleColor);
			} else if (isIconTarget) {
				el.style.backgroundColor = "transparent";
				el.style.color = roleColor;
				paintSvgIcons(el, roleColor);
			} else if (originallyTransparent && originallyBordered) {
				el.style.backgroundColor = "transparent";
				el.style.color = roleColor;
				el.style.borderColor = roleColor;
			} else if (originallyTransparent) {
				return;
			} else {
				el.style.backgroundColor = roleColor;
				el.style.color =
					role === "accent" ? effectivePalette.onAccent : effectivePalette.text;
			}

			el.querySelectorAll("i").forEach((icon) => {
				icon.style.color = el.style.color || roleColor;
			});

			const computed = window.getComputedStyle(el);
			if (
				!customSwatch &&
				computed.borderWidth !== "0px" &&
				computed.borderStyle !== "none"
			) {
				el.style.borderColor = roleColor;
			}
		});
	});
}

/**
 * Reset all inline color/background/border styles previously applied.
 */
export function resetElementStyles(elements, root) {
	if (!root) return;
	elements.forEach((element) => {
		getElementMatches(element, root).forEach((el) => {
			el.style.backgroundColor = "";
			el.style.color = "";
			el.style.borderColor = "";
			resetSvgIcons(el);
			el.querySelectorAll("i").forEach((icon) => {
				icon.style.color = "";
			});
		});
	});
}

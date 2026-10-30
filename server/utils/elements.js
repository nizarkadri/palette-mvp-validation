import { HEX_COLOR_RE, VALID_ROLES } from "../constants.js";

function htmlTargetIds(html, { includeClassFallback = false } = {}) {
	const targetIds = new Set(["app-bg"]);
	for (const match of html.matchAll(/data-palette-id=(["'])(.*?)\1/gi)) {
		if (match[2]) targetIds.add(match[2].trim());
	}
	for (const match of html.matchAll(/data-el=(["'])(.*?)\1/gi)) {
		if (match[2]) targetIds.add(match[2].trim());
	}

	// Class fallback is only for legacy/failed semantic output. Treating every
	// layout class as a palette hook over-maps parent containers and causes broad
	// background recoloring instead of targeting the visible painted elements.
	if (includeClassFallback && targetIds.size === 1) {
		for (const match of html.matchAll(/class=(["'])(.*?)\1/gi)) {
			match[2]
				.split(/\s+/)
				.map((className) => className.trim())
				.filter(Boolean)
				.forEach((className) => targetIds.add(className));
		}
	}
	return targetIds;
}

function labelFromId(id) {
	return String(id)
		.split("-")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function inferRole(id) {
	if (id === "app-bg" || id.includes("nav") || id.includes("background")) {
		return "primary";
	}
	if (
		id.includes("accent") ||
		id.includes("avatar") ||
		id.includes("icon") ||
		id.includes("chip") ||
		id.includes("cta") ||
		id.includes("active") ||
		id.includes("badge")
	) {
		return "accent";
	}
	return "secondary";
}

function inferIsText(id) {
	return /(?:text|heading|title|label|caption|muted|username|time|save|body|content|role|stat|amount|link)/i.test(
		id,
	);
}

function selectorForId(id) {
	const safeId = String(id).replace(/"/g, '\\"');
	if (id === "app-bg") {
		return '[data-el="app-bg"], [data-palette-id="app-bg"], .s2c-screen';
	}
	return `[data-palette-id="${safeId}"], [data-el="${safeId}"], .${safeId}`;
}

function normalizeSemanticElement(element) {
	const id = String(
		element?.id || element?.el || element?.dataEl || element?.data_el || "",
	).trim();
	if (!id) return null;
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
			: [selectorForId(id)];
	const isText =
		typeof element.isText === "boolean" ? element.isText : inferIsText(id);
	const legacyRole = element.role === "uncategorized" ? "custom" : element.role;
	const role = VALID_ROLES.has(legacyRole) ? legacyRole : "custom";
	return {
		id,
		selector: explicitSelector || selectors.join(", "),
		selectors,
		label: element.label || labelFromId(id),
		role,
		rationale:
			typeof element.rationale === "string"
				? element.rationale
				: role === "custom"
					? "Low-confidence or user-review hook."
					: "Inferred from stable hook name.",
		swatch: HEX_COLOR_RE.test(element.swatch) ? element.swatch : "#888888",
		isText,
		textLocked:
			typeof element.textLocked === "boolean" ? element.textLocked : isText,
		source: element.source === "manual" ? "manual" : "ai",
	};
}

function fallbackElementFromTarget(id) {
	const role = inferRole(id);
	const isText = inferIsText(id);
	return {
		id,
		selector: selectorForId(id),
		selectors: [selectorForId(id)],
		label: labelFromId(id),
		role,
		rationale: "Deterministic fallback from generated preview hook.",
		swatch: "#888888",
		isText,
		textLocked: isText,
		source: "ai",
	};
}

function selectorIsPlausible(element, targetIds) {
	return (
		element.id === "app-bg" ||
		targetIds.has(element.id) ||
		(Array.isArray(element.selectors) && element.selectors.length > 0) ||
		(typeof element.selector === "string" && element.selector.trim().length > 0)
	);
}

export function finalizeSemanticElements(parsed, html) {
	const sourceElements = Array.isArray(parsed?.elements) ? parsed.elements : [];
	const targetIds = htmlTargetIds(html, {
		includeClassFallback: sourceElements.length === 0,
	});
	const seen = new Set();
	const elements = [];

	sourceElements
		.map((element) => normalizeSemanticElement(element))
		.filter(Boolean)
		.forEach((element) => {
			if (seen.has(element.id)) return;
			if (!selectorIsPlausible(element, targetIds)) {
				console.warn(
					`Element id "${element.id}" not found in generated hooks — dropping`,
				);
				return;
			}
			seen.add(element.id);
			elements.push(element);
		});

	targetIds.forEach((id) => {
		if (!seen.has(id)) {
			seen.add(id);
			elements.push(fallbackElementFromTarget(id));
		}
	});

	return elements;
}

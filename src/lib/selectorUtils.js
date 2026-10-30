export function cssEscape(value) {
	if (typeof window !== "undefined" && window.CSS?.escape) {
		return window.CSS.escape(value);
	}
	return String(value).replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

export function selectorForId(id) {
	const escaped = cssEscape(id);
	const baseSelector = `[data-palette-id="${escaped}"], [data-el="${escaped}"], .${escaped}`;
	return id === "app-bg" ? `${baseSelector}, .s2c-screen` : baseSelector;
}

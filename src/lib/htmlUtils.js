export function stripGeneratedHtmlNoise(html) {
	return String(html || "")
		.trim()
		.replace(/^```html\s*/i, "")
		.replace(/^```\s*/i, "")
		.replace(/```\s*$/i, "")
		.trim();
}

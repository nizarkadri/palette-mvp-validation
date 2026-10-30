import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { SCREENSHOT_VIEWPORT } from "../constants.js";

const DOM_PURIFY_WINDOW = new JSDOM("").window;
const DOM_PURIFY = createDOMPurify(DOM_PURIFY_WINDOW);

function stripCodeFence(text) {
	const trimmed = String(text || "").trim();
	const fencedBlock = trimmed.match(
		/^```[ \t]*(?:[a-zA-Z0-9_-]+)?[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*$/,
	);
	if (fencedBlock) return fencedBlock[1].trim();

	return trimmed
		.replace(/^```(?:[a-zA-Z0-9_-]+)?\s*/i, "")
		.replace(/```\s*$/i, "")
		.trim();
}

export function parseJsonObject(text) {
	return JSON.parse(stripCodeFence(text));
}

export function sanitizeGeneratedHtml(html) {
	return DOM_PURIFY.sanitize(String(html || ""), {
		WHOLE_DOCUMENT: true,
		FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "meta"],
		FORBID_ATTR: ["srcdoc"],
		ALLOW_UNKNOWN_PROTOCOLS: false,
	});
}

function normalizeGenerationResponse(parsed) {
	if (typeof parsed.html === "string") return { html: parsed.html };
	const htmlKey = ["html", "reconstruction", "ui", "markup", "code"].find(
		(key) => typeof parsed[key] === "string",
	);
	if (htmlKey) return { html: parsed[htmlKey] };
	throw new Error(
		`Generation response missing html. Keys: ${Object.keys(parsed).join(", ")}`,
	);
}

export function finalizeGeneratedHtml(parsed) {
	const normalized = normalizeGenerationResponse(parsed);
	return sanitizeGeneratedHtml(normalized.html);
}

export function htmlFromRawModelText(text) {
	let cleaned = stripCodeFence(text);
	const fileMatch = cleaned.match(/<file\b[^>]*>([\s\S]*?)<\/file>/i);
	if (fileMatch) cleaned = fileMatch[1].trim();
	cleaned = cleaned
		.replace(/^```html\s*/i, "")
		.replace(/^```\s*/i, "")
		.replace(/```\s*$/i, "")
		.trim();
	if (/<(?:!doctype|html|head|body)\b/i.test(cleaned)) {
		return sanitizeGeneratedHtml(cleaned);
	}
	if (
		/<(?:style|div|section|main|article|nav|header|footer|svg)\b/i.test(cleaned)
	) {
		return sanitizeGeneratedHtml(cleaned);
	}
	return "";
}

export function documentForScreenshot(html) {
	const content = String(html || "");
	if (/<(?:!doctype|html)\b/i.test(content)) return content;
	return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#000;min-width:${SCREENSHOT_VIEWPORT.width}px;min-height:${SCREENSHOT_VIEWPORT.height}px;}</style></head><body>${content}</body></html>`;
}

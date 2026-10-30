import { SINGLE_FRAME_RECONSTRUCTION_RULES } from "./frameConstraints.js";

export function buildVisualCorrectionUserText({
	evaluation,
	currentHtml,
	fitDiagnostics,
}) {
	const fitSection = fitDiagnostics
		? `\n\nFrame fit diagnostics:\n${JSON.stringify(fitDiagnostics, null, 2)}`
		: "";
	return `The first image is the original screenshot. The second image is a browser screenshot of the current generated HTML. Fix visual discrepancies between them while preserving all local hard constraints: no icon libraries, no emoji icons, no device frame, no scripts, inline SVG/CSS icons only. Prefer targeted edit_file calls; use create_file only if a rewrite is clearly safer.\n\n${SINGLE_FRAME_RECONSTRUCTION_RULES}\n\nIf frame fit diagnostics are provided, make targeted HTML/CSS edits so the entire UI fits inside .s2c-screen without scrolling or clipping. Do not regenerate from scratch unless the current structure cannot be safely edited.\n\nEvaluator findings:\n${JSON.stringify(evaluation || {}, null, 2)}${fitSection}\n\nCurrent index.html:\n\n${currentHtml}`;
}

export const TEXT_ONLY_VISUAL_CORRECTION_PROMPT =
	"Return the corrected final code directly as one complete index.html document or fenced html block. Do not call tools and do not return an image.";

import path from "node:path";

export const DEFAULT_MODEL_ID = "minimax/minimax-m3";
export const DEBUG_ROOT = path.join(process.cwd(), "debug", "analysis");
export const VALID_ROLES = new Set([
	"primary",
	"secondary",
	"accent",
	"custom",
]);
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const GEMINI_IMAGE_VARIANT_MODEL_ID = "google/gemini-3.1-flash-image";
export const GEMINI_LITE_IMAGE_VARIANT_MODEL_ID =
	"google/gemini-3.1-flash-lite-image";
export const DEFAULT_VARIANT_COUNT = 3;
export const MAX_VARIANT_COUNT = 4;
export const VISUAL_VERIFICATION_MIN_SCORE = 0.82;
export const SCREENSHOT_VIEWPORT = { width: 390, height: 844 };

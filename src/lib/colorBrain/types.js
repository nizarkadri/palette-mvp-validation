export const CREATIVITY_MODES = ["safe", "balanced", "expressive", "wild"];
export const THEME_MODES = ["light", "dark", "auto"];

export const DEFAULT_COLORBRAIN_OPTIONS = {
	count: 24,
	creativity: "balanced",
	theme: "auto",
	randomSeed: "colorBrain",
};

export function normalizeCreativityMode(mode) {
	return CREATIVITY_MODES.includes(mode)
		? mode
		: DEFAULT_COLORBRAIN_OPTIONS.creativity;
}

export function normalizeThemeMode(mode) {
	return THEME_MODES.includes(mode) ? mode : DEFAULT_COLORBRAIN_OPTIONS.theme;
}

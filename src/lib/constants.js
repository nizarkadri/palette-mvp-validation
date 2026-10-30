export const VALID_ROLES = new Set([
	"primary",
	"secondary",
	"accent",
	"custom",
]);

export const MUTATING_ROLES = new Set(["primary", "secondary", "accent"]);

export const CUSTOM_SWATCH_ROLE_RE = /^custom-\d+$/;

export function isCustomSwatchRole(role) {
	return typeof role === "string" && CUSTOM_SWATCH_ROLE_RE.test(role);
}

export function isKnownElementRole(role) {
	return VALID_ROLES.has(role) || isCustomSwatchRole(role);
}

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

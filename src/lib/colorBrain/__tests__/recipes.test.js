import { beforeAll, describe, expect, it } from "vitest";
import { expectHex, loadModule } from "./testUtils.js";

let recipes;

beforeAll(async () => {
	recipes = await loadModule("../recipes.js");
});

describe("colorBrain recipe palette generation", () => {
	it("defines curated recipe families for local UI palette generation", () => {
		const paletteRecipes = recipes.getPaletteRecipes();

		expect(paletteRecipes.length).toBeGreaterThanOrEqual(12);
		expect(paletteRecipes.map((recipe) => recipe.id)).toEqual(
			expect.arrayContaining([
				"soft-editorial",
				"dark-premium",
				"fresh-saas",
				"calm-healthcare",
			]),
		);
	});

	it("generates complete role-first UI theme candidates", () => {
		const candidates = recipes.generateRecipeThemeCandidates({
			count: 8,
			seedColor: "#fa5c7c",
			creativity: "balanced",
			theme: "auto",
			randomSeed: "recipe-test",
		});

		expect(candidates).toHaveLength(8);
		candidates.forEach((candidate) => {
			expect(candidate.source).toBe("local-recipe");
			expect(candidate.strategy).toBe("recipe-based-ui-theme");
			expect(candidate.recipe).toEqual(expect.any(String));
			expect(candidate.visibleRoles).toEqual({
				background: expect.any(String),
				surface: expect.any(String),
				accent: expect.any(String),
				text: expect.any(String),
				muted: expect.any(String),
			});

			[
				candidate.visibleRoles.background,
				candidate.visibleRoles.surface,
				candidate.visibleRoles.accent,
				candidate.visibleRoles.text,
				candidate.visibleRoles.muted,
			].forEach(expectHex);
		});
	});

	it("is deterministic for a fixed randomSeed while preserving the seed as a first accent", () => {
		const input = {
			count: 5,
			seedColor: "#14b8a6",
			creativity: "expressive",
			theme: "light",
			randomSeed: "stable-recipes",
		};

		const first = recipes.generateRecipeThemeCandidates(input);
		const second = recipes.generateRecipeThemeCandidates(input);
		const third = recipes.generateRecipeThemeCandidates({
			...input,
			randomSeed: "different-recipes",
		});

		expect(first).toEqual(second);
		expect(first).not.toEqual(third);
		expect(first[0].roles.accent).toBe("#14b8a6");
	});
});

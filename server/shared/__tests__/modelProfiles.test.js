import { describe, expect, it } from "vitest";
import {
	DEFAULT_MODEL_ID,
	GEMINI_IMAGE_VARIANT_MODEL_ID,
	GEMINI_LITE_IMAGE_VARIANT_MODEL_ID,
} from "../../constants.js";
import {
	DEFAULT_MODEL_PROFILE_ID,
	MODEL_PROFILE_REGISTRY,
	MODEL_PROFILE_REVISION,
	ModelProfileResolutionError,
	isCanonicalModelProfile,
	isCanonicalProviderDescriptor,
	resolveAnalysisProfile,
	resolveAnalysisVariantProfile,
	resolveAnalysisVariantProfiles,
	resolveLegacyImprovementModelProfile,
	resolveModelProfile,
} from "../modelProfiles.js";
import { createContextFixture } from "./testUtils.js";

function expectDeeplyFrozenJsonLike(value, ancestors = new Set()) {
	if (value === null || ["string", "boolean"].includes(typeof value)) return;
	if (typeof value === "number") {
		expect(Number.isFinite(value)).toBe(true);
		return;
	}
	expect(typeof value).toBe("object");
	expect(ancestors.has(value)).toBe(false);
	expect(Object.isFrozen(value)).toBe(true);
	expect(Object.getOwnPropertySymbols(value)).toHaveLength(0);
	if (!Array.isArray(value)) {
		expect([Object.prototype, null]).toContain(Object.getPrototypeOf(value));
	}
	ancestors.add(value);
	for (const nested of Object.values(value)) {
		expectDeeplyFrozenJsonLike(nested, ancestors);
	}
	ancestors.delete(value);
}

function allProfiles() {
	return Object.values(MODEL_PROFILE_REGISTRY.jobKinds).flatMap((entry) =>
		Object.values(entry.profiles),
	);
}

function expectSafeRejection(value) {
	let caught;
	try {
		resolveLegacyImprovementModelProfile(value);
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(ModelProfileResolutionError);
	expect(caught).toMatchObject({
		message: "Requested model profile is not available.",
		code: "MODEL_PROFILE_NOT_ALLOWED",
	});
	if (typeof value === "string" && value) {
		expect(caught.message).not.toContain(value);
	}
}

describe("server-owned model profiles", () => {
	it("exports only deeply frozen JSON-like registry data", () => {
		expectDeeplyFrozenJsonLike(MODEL_PROFILE_REGISTRY);
		expect(() => JSON.parse(JSON.stringify(MODEL_PROFILE_REGISTRY))).not.toThrow();
		expect(() => {
			MODEL_PROFILE_REGISTRY.jobKinds.analysis.profiles.default.variants[0]
				.provider.modelId = "caller/model";
		}).toThrow();
		expect(resolveAnalysisVariantProfile(0).provider.modelId).toBe(
			DEFAULT_MODEL_ID,
		);
	});

	it("carries one versioned revision and data required for boundary wiring", () => {
		expect(MODEL_PROFILE_REGISTRY).toMatchObject({
			schemaVersion: 1,
			revision: MODEL_PROFILE_REVISION,
		});
		for (const profile of allProfiles()) {
			expect(profile.revision).toBe(MODEL_PROFILE_REVISION);
			expect(profile.attemptLedgerCeilings).toMatchObject({
				maxCalls: expect.any(Number),
				maxInputTokens: expect.any(Number),
				maxOutputTokens: expect.any(Number),
				maxCostMicros: expect.any(Number),
			});
			for (const ceiling of Object.values(profile.attemptLedgerCeilings)) {
				expect(Number.isSafeInteger(ceiling)).toBe(true);
				expect(ceiling).toBeGreaterThan(0);
			}
			const providers = profile.variants
				? profile.variants.map((variant) => variant.provider)
				: [profile.provider];
			for (const provider of providers) {
				expect(provider).toMatchObject({
					providerId: "openrouter",
					modelId: expect.any(String),
					requestTimeoutMs: 120_000,
					supportsToolUse: expect.any(Boolean),
					requestCeilings: {
						maxInputTokens: expect.any(Number),
						maxOutputTokens: expect.any(Number),
					},
					worstCaseReservation: {
						inputTokens: expect.any(Number),
						outputTokens: expect.any(Number),
						costMicros: expect.any(Number),
					},
				});
				for (const value of [
					provider.requestTimeoutMs,
					...Object.values(provider.requestCeilings),
					...Object.values(provider.worstCaseReservation),
				]) {
					expect(Number.isSafeInteger(value)).toBe(true);
					expect(value).toBeGreaterThan(0);
				}
				expect(provider.worstCaseReservation.inputTokens).toBeGreaterThanOrEqual(
					provider.requestCeilings.maxInputTokens,
				);
				expect(provider.worstCaseReservation.outputTokens).toBeGreaterThanOrEqual(
					provider.requestCeilings.maxOutputTokens,
				);
				expect(profile.attemptLedgerCeilings.maxInputTokens).toBeGreaterThanOrEqual(
					profile.attemptLedgerCeilings.maxCalls *
						provider.worstCaseReservation.inputTokens,
				);
				expect(profile.attemptLedgerCeilings.maxOutputTokens).toBeGreaterThanOrEqual(
					profile.attemptLedgerCeilings.maxCalls *
						provider.worstCaseReservation.outputTokens,
				);
				expect(profile.attemptLedgerCeilings.maxCostMicros).toBeGreaterThanOrEqual(
					profile.attemptLedgerCeilings.maxCalls *
						provider.worstCaseReservation.costMicros,
				);
			}
		}
	});

	it("uses registry identity rather than frozen shape or self-asserted revision", () => {
		const canonical = resolveModelProfile("improvement", "default");
		const fabricatedProvider = Object.freeze({
			...canonical.provider,
			requestCeilings: Object.freeze({ ...canonical.provider.requestCeilings }),
			worstCaseReservation: Object.freeze({
				...canonical.provider.worstCaseReservation,
			}),
		});
		const fabricatedProfile = Object.freeze({
			...canonical,
			provider: fabricatedProvider,
			attemptLedgerCeilings: Object.freeze({
				...canonical.attemptLedgerCeilings,
			}),
		});

		expect(isCanonicalModelProfile(canonical)).toBe(true);
		expect(isCanonicalProviderDescriptor(canonical.provider)).toBe(true);
		expect(isCanonicalModelProfile(fabricatedProfile)).toBe(false);
		expect(isCanonicalProviderDescriptor(fabricatedProvider)).toBe(false);
		expect(() =>
			createContextFixture({
				modelProfile: fabricatedProfile,
				modelProfileRevision: fabricatedProfile.revision,
			}),
		).toThrow("canonical server-owned job profile");
	});

	it("is compatible with processor context revision validation", () => {
		for (const profile of allProfiles()) {
			const context = createContextFixture({
				modelProfile: profile,
				modelProfileRevision: MODEL_PROFILE_REVISION,
			});
			expect(context.modelProfile).toBe(profile);
		}
	});

	it("provides exactly three deterministic analysis variants at indexes 0, 1, and 2", () => {
		const variants = resolveAnalysisVariantProfiles();
		expect(variants).toHaveLength(3);
		expect(variants.map((profile) => profile.variantIndex)).toEqual([0, 1, 2]);
		expect(variants.map((profile) => profile.provider.modelId)).toEqual([
			DEFAULT_MODEL_ID,
			GEMINI_IMAGE_VARIANT_MODEL_ID,
			GEMINI_LITE_IMAGE_VARIANT_MODEL_ID,
		]);
		expect(resolveAnalysisVariantProfile(0)).toBe(variants[0]);
		expect(resolveAnalysisVariantProfile(1)).toBe(variants[1]);
		expect(resolveAnalysisVariantProfile(2)).toBe(variants[2]);
		expect(() => resolveAnalysisVariantProfile(3)).toThrow(
			ModelProfileResolutionError,
		);
	});

	it("keeps one attempt-ledger owner per job profile and exact registry keys", () => {
		expect(Object.keys(MODEL_PROFILE_REGISTRY.jobKinds)).toEqual([
			"analysis",
			"categorization",
			"improvement",
			"custom-swatch",
		]);
		expect(
			Object.keys(MODEL_PROFILE_REGISTRY.jobKinds.analysis.profiles),
		).toEqual([DEFAULT_MODEL_PROFILE_ID]);
		expect(
			Object.keys(MODEL_PROFILE_REGISTRY.jobKinds.categorization.profiles),
		).toEqual([DEFAULT_MODEL_PROFILE_ID]);
		expect(
			Object.keys(MODEL_PROFILE_REGISTRY.jobKinds.improvement.profiles),
		).toEqual(["default", "gemini-image", "gemini-lite-image"]);
		expect(
			Object.keys(MODEL_PROFILE_REGISTRY.jobKinds["custom-swatch"].profiles),
		).toEqual([DEFAULT_MODEL_PROFILE_ID]);
		for (const variant of resolveAnalysisVariantProfiles()) {
			expect(variant).not.toHaveProperty("attemptLedgerCeilings");
		}
	});

	it("resolves exact known legacy model IDs to canonical improvement profiles", () => {
		const cases = [
			[DEFAULT_MODEL_ID, DEFAULT_MODEL_PROFILE_ID, true],
			[GEMINI_IMAGE_VARIANT_MODEL_ID, "gemini-image", false],
			[GEMINI_LITE_IMAGE_VARIANT_MODEL_ID, "gemini-lite-image", false],
		];
		for (const [modelId, profileId, supportsToolUse] of cases) {
			const profile = resolveLegacyImprovementModelProfile(modelId);
			expect(profile).toBe(resolveModelProfile("improvement", profileId));
			expect(profile).toMatchObject({
				jobKind: "improvement",
				provider: { modelId, supportsToolUse },
			});
		}
	});

	it("allows surrounding whitespace but returns only canonical registry data", () => {
		const callerValue = ` \n\t${GEMINI_IMAGE_VARIANT_MODEL_ID}\r `;
		const profile = resolveLegacyImprovementModelProfile(callerValue);
		expect(profile).toBe(resolveModelProfile("improvement", "gemini-image"));
		expect(profile.provider.modelId).toBe(GEMINI_IMAGE_VARIANT_MODEL_ID);
		expect(profile.provider.modelId).not.toBe(callerValue);
	});

	it.each([
		DEFAULT_MODEL_ID.toUpperCase(),
		"Minimax/minimax-m3",
		"minimax/minimax-mЗ",
		"minimax/minimax-m3\u200b",
		"minimax/minimax-m4",
		"anthropic/claude-sonnet-4",
		"unknown/model",
		"toString",
		"__proto__",
		"",
		"   ",
	])("rejects case variants, lookalikes, and unknown model IDs: %j", (value) => {
		expectSafeRejection(value);
	});

	it("rejects non-string callers without coercion or passthrough", () => {
		let trimCalled = false;
		const callerControlled = {
			trim() {
				trimCalled = true;
				return DEFAULT_MODEL_ID;
			},
			toString() {
				throw new Error("must not stringify caller input");
			},
		};
		expectSafeRejection(callerControlled);
		expect(trimCalled).toBe(false);
		expectSafeRejection(Object(DEFAULT_MODEL_ID));
	});

	it("rejects profile IDs under the wrong job kind and does not trim profile IDs", () => {
		expect(resolveAnalysisProfile()).toBe(
			resolveModelProfile("analysis", DEFAULT_MODEL_PROFILE_ID),
		);
		expect(() =>
			resolveModelProfile("categorization", "gemini-image"),
		).toThrow(ModelProfileResolutionError);
		expect(() =>
			resolveModelProfile("improvement", " gemini-image "),
		).toThrow(ModelProfileResolutionError);
		expect(() => resolveModelProfile("toString", "default")).toThrow(
			ModelProfileResolutionError,
		);
		expect(() => resolveModelProfile("analysis", "__proto__")).toThrow(
			ModelProfileResolutionError,
		);
	});
});

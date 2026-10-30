import { afterEach, describe, expect, it, vi } from "vitest";
import {
	GenerationOutputError,
	generateCandidate,
	generationIssues,
	modelSupportsToolUse,
	variantModelIds,
} from "../screenshotGenerator.js";
import { ProviderRequestError, createProviderRequestIdFactory } from "../openRouter.js";
import { resolveModelProfile } from "../../shared/modelProfiles.js";
import { createProviderLedger } from "../../shared/providerLedger.js";
import { createContextFixture } from "../../shared/__tests__/testUtils.js";

const primaryModel = "minimax/minimax-m3";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function generationFixture() {
	const modelProfile = resolveModelProfile("analysis", "default");
	const providerLedger = createProviderLedger({
		attemptId: "attempt-1",
		...modelProfile.attemptLedgerCeilings,
	});
	const context = createContextFixture({
		modelProfile,
		modelProfileRevision: modelProfile.revision,
		providerLedger,
	});
	return {
		context,
		provider: modelProfile.variants[1].provider,
		nextProviderRequestId: createProviderRequestIdFactory({
			attemptId: context.identity.attemptId,
			prefix: "malformed-generation",
		}),
	};
}

function textResponse(content) {
	return {
		ok: true,
		status: 200,
		json: vi.fn().mockResolvedValue({
			choices: [{ finish_reason: "stop", message: { content } }],
		}),
	};
}

describe("screenshotGenerator model selection", () => {
	it("uses three distinct default variant models", () => {
		expect(variantModelIds({}, primaryModel)).toEqual([
			"minimax/minimax-m3",
			"google/gemini-3.1-flash-image",
			"google/gemini-3.1-flash-lite-image",
		]);
	});

	it("uses configured secondary model before the lite fallback", () => {
		expect(
			variantModelIds(
				{ OPENROUTER_SECONDARY_MODEL_ID: "anthropic/claude-sonnet-4" },
				primaryModel,
			),
		).toEqual([
			"minimax/minimax-m3",
			"anthropic/claude-sonnet-4",
			"google/gemini-3.1-flash-lite-image",
		]);
	});

	it.each([
		"1",
		"2",
		"4",
		"not-a-number",
	])("rejects configured variant count %s before provider dispatch", (configuredCount) => {
		expect(() =>
			variantModelIds(
				{ OPENROUTER_VARIANT_COUNT: configuredCount },
				primaryModel,
			),
		).toThrow("OPENROUTER_VARIANT_COUNT must be exactly 3.");
	});

	it("accepts an explicit configured variant count of three", () => {
		expect(
			variantModelIds({ OPENROUTER_VARIANT_COUNT: "3" }, primaryModel),
		).toHaveLength(3);
	});

	it("runs both Gemini image variants without tool use", () => {
		expect(modelSupportsToolUse("google/gemini-3.1-flash-image")).toBe(false);
		expect(modelSupportsToolUse("google/gemini-3.1-flash-lite-image")).toBe(
			false,
		);
	});
});

describe("screenshotGenerator processor failure classification", () => {
	it("classifies a real text-only no-HTML response as degradable provider response failure", async () => {
		const fixture = generationFixture();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(textResponse("I cannot create that page.")),
		);

		let caught;
		try {
			await generateCandidate({
				apiKey: "key",
				base64: "source-image",
				mediaType: "image/png",
				variantIndex: 1,
				...fixture,
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(ProviderRequestError);
		expect(caught).toMatchObject({
			code: "PROVIDER_RESPONSE_ERROR",
			retryable: false,
		});
		expect(caught.message).not.toContain("I cannot create");
	});

	it("classifies fatal regenerated HTML as a degradable generation-output failure", async () => {
		const fixture = generationFixture();
		const emptyBody =
			"<!doctype html><html><head><style>body{background:#000}</style></head><body></body></html>";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(textResponse(emptyBody)),
		);

		let caught;
		try {
			await generateCandidate({
				apiKey: "key",
				base64: "source-image",
				mediaType: "image/png",
				variantIndex: 1,
				...fixture,
			});
		} catch (error) {
			caught = error;
		}
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(caught).toBeInstanceOf(GenerationOutputError);
		expect(caught).toMatchObject({
			code: "GENERATION_OUTPUT_INVALID",
			retryable: false,
		});
		expect(caught.message).not.toContain("has no visible body content");
	});
});

describe("screenshotGenerator generation issues", () => {
	it("flags complete documents with empty bodies as unusable", () => {
		expect(
			generationIssues(
				"<html><head><style>body{background:#000}</style></head><body></body></html>",
			),
		).toContain("has no visible body content");
	});

	it("allows complete documents with visible body content", () => {
		expect(
			generationIssues(
				'<html><head><style>body{background:#000}</style></head><body><main class="s2c-screen">Hello</main></body></html>',
			),
		).not.toContain("has no visible body content");
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	generateCandidate: vi.fn(),
	variantModelIds: vi.fn(),
	writeDebugJson: vi.fn(),
	callOpenRouterForProcessor: vi.fn(),
	parseOrRepairForProcessor: vi.fn(),
	ProviderRequestError: class ProviderRequestError extends Error {},
	getScreenshotBrowser: vi.fn(),
}));

vi.mock("../screenshotGenerator.js", () => ({
	generateCandidate: mocks.generateCandidate,
	generationIssues: vi.fn(),
	modelSupportsToolUse: vi.fn(),
	runHtmlToolAgent: vi.fn(),
	variantModelIds: mocks.variantModelIds,
}));

vi.mock("../../utils/debug.js", () => ({
	writeDebugJson: mocks.writeDebugJson,
	writeDebugText: vi.fn(),
}));

vi.mock("../browserPool.js", () => ({
	getScreenshotBrowser: mocks.getScreenshotBrowser,
}));

vi.mock("../openRouter.js", () => ({
	ProviderRequestError: mocks.ProviderRequestError,
	callOpenRouter: vi.fn(),
	callOpenRouterForProcessor: mocks.callOpenRouterForProcessor,
	parseOrRepair: vi.fn(),
	parseOrRepairForProcessor: mocks.parseOrRepairForProcessor,
}));

import { ProcessorCancelledError } from "../../shared/errors.js";
import { createContextFixture } from "../../shared/__tests__/testUtils.js";
import {
	evaluateRenderedCandidate,
	generateVerifiedHtml,
	renderHtmlScreenshotForProcessor,
} from "../visualVerifier.js";

const modelIds = ["model-zero", "model-one", "model-two"];
const session = { id: "debug-id", relativeDir: "debug/analysis/debug-id" };

function candidateFor(variantIndex, modelId = modelIds[variantIndex]) {
	return {
		variantIndex,
		modelId,
		html: `<main>variant ${variantIndex + 1}</main>`,
		issues: [],
		visualEvaluation: null,
		renderedScreenshot: null,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.variantModelIds.mockReturnValue(modelIds);
	mocks.writeDebugJson.mockResolvedValue(undefined);
});

describe("context-aware render fallback", () => {
	const renderSession = { ...session, dir: "/tmp" };

	it("rethrows render control flow without degrading", async () => {
		const reason = new ProcessorCancelledError({ stage: "browser" });
		mocks.getScreenshotBrowser.mockRejectedValue(reason);

		await expect(
			renderHtmlScreenshotForProcessor({
				html: "<main>preview</main>",
				session: renderSession,
				fileNameBase: "preview",
				context: createContextFixture(),
			}),
		).rejects.toBe(reason);
	});

	it("rejects invalid processor context instead of degrading an invariant failure", async () => {
		await expect(
			renderHtmlScreenshotForProcessor({
				html: "<main>preview</main>",
				session: renderSession,
				fileNameBase: "preview",
				context: null,
			}),
		).rejects.toThrow("processor context is required");
		expect(mocks.writeDebugJson).not.toHaveBeenCalled();
	});

	it("degrades an ordinary classified render failure to null", async () => {
		mocks.getScreenshotBrowser.mockRejectedValue(new Error("browser missing"));

		await expect(
			renderHtmlScreenshotForProcessor({
				html: "<main>preview</main>",
				session: renderSession,
				fileNameBase: "preview",
				context: createContextFixture(),
			}),
		).resolves.toBeNull();
		expect(mocks.writeDebugJson).toHaveBeenCalledWith(
			renderSession,
			"preview-screenshot-error.json",
			expect.objectContaining({
				message: "The rendered preview is unavailable.",
			}),
		);
	});

	it("rejects diagnostic I/O failure rather than swallowing it", async () => {
		const diagnosticError = new Error("debug disk failed");
		mocks.getScreenshotBrowser.mockRejectedValue(new Error("browser missing"));
		mocks.writeDebugJson.mockRejectedValueOnce(diagnosticError);

		await expect(
			renderHtmlScreenshotForProcessor({
				html: "<main>preview</main>",
				session: renderSession,
				fileNameBase: "preview",
				context: createContextFixture(),
			}),
		).rejects.toBe(diagnosticError);
	});

	it("rejects cleanup failure attached to a degradable browser error", async () => {
		const renderFailure = new Error("page content failed");
		const cleanupFailure = new Error("page close failed");
		const page = {
			setContent: vi.fn().mockRejectedValue(renderFailure),
			close: vi.fn().mockRejectedValue(cleanupFailure),
		};
		mocks.getScreenshotBrowser.mockResolvedValue({
			newPage: vi.fn().mockResolvedValue(page),
		});

		let caught;
		try {
			await renderHtmlScreenshotForProcessor({
				html: "<main>preview</main>",
				session: renderSession,
				fileNameBase: "preview",
				context: createContextFixture(),
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toMatchObject({ code: "RENDER_UNAVAILABLE" });
		expect(caught.secondaryErrors).toEqual([
			{ label: "Chromium page cleanup failed.", error: cleanupFailure },
		]);
		expect(page.close).toHaveBeenCalledOnce();
		expect(mocks.writeDebugJson).not.toHaveBeenCalled();
	});
});

describe("context-aware visual evaluation fallback", () => {
	const boundary = {
		context: { signal: new AbortController().signal },
		provider: Object.freeze({ providerId: "openrouter" }),
		nextProviderRequestId: vi.fn(),
	};

	it("rethrows processor control flow before evaluation fallback", async () => {
		const reason = new ProcessorCancelledError({ stage: "evaluation" });
		mocks.callOpenRouterForProcessor.mockRejectedValue(reason);
		const candidate = {
			...candidateFor(0),
			renderedScreenshot: { base64: "rendered" },
		};

		await expect(
			evaluateRenderedCandidate({
				apiKey: "key",
				base64: "source",
				mediaType: "image/png",
				session,
				candidate,
				debugPrefix: "variant-1",
				...boundary,
			}),
		).rejects.toBe(reason);
		expect(mocks.writeDebugJson).not.toHaveBeenCalled();
	});

	it("rethrows the original provider failure when strict processor mode opts out", async () => {
		const expected = new mocks.ProviderRequestError("evaluation unavailable");
		expected.code = "PROVIDER_HTTP_RETRYABLE";
		expected.retryable = true;
		mocks.callOpenRouterForProcessor.mockRejectedValue(expected);
		const candidate = {
			...candidateFor(0),
			renderedScreenshot: { base64: "rendered" },
		};

		await expect(
			evaluateRenderedCandidate({
				apiKey: "key",
				base64: "source",
				mediaType: "image/png",
				session,
				candidate,
				debugPrefix: "variant-1",
				strictProviderErrors: true,
				...boundary,
			}),
		).rejects.toBe(expected);
		expect(mocks.writeDebugJson).not.toHaveBeenCalled();
	});

	it("retains the documented ordinary evaluation fallback", async () => {
		mocks.callOpenRouterForProcessor.mockRejectedValue(
			new mocks.ProviderRequestError("evaluation unavailable"),
		);
		const candidate = {
			...candidateFor(0),
			renderedScreenshot: { base64: "rendered" },
		};

		await expect(
			evaluateRenderedCandidate({
				apiKey: "key",
				base64: "source",
				mediaType: "image/png",
				session,
				candidate,
				debugPrefix: "variant-1",
				...boundary,
			}),
		).resolves.toBe(candidate);
		expect(candidate.visualEvaluation).toBeNull();
		expect(mocks.writeDebugJson).toHaveBeenCalledWith(
			session,
			"variant-1-visual-evaluation-error.json",
			{ message: "evaluation unavailable" },
		);
	});
});

describe("legacy analysis all-three terminal correction", () => {
	it.each([
		[[0]],
		[[1, 2]],
		[[0, 1, 2]],
	])("rejects safely when generation variants %j fail", async (failedIndexes) => {
		mocks.generateCandidate.mockImplementation(
			async ({ variantIndex, modelId }) => {
				if (failedIndexes.includes(variantIndex)) {
					throw new Error(`private provider detail ${variantIndex}`);
				}
				return candidateFor(variantIndex, modelId);
			},
		);

		await expect(
			generateVerifiedHtml({
				apiKey: "key",
				env: {},
				modelId: modelIds[0],
				base64: "image-data",
				mediaType: "image/png",
				session,
			}),
		).rejects.toThrow("Analysis could not complete all three variants.");

		expect(mocks.writeDebugJson).toHaveBeenCalledWith(
			session,
			"generation-variant-errors.json",
			expect.arrayContaining(
				failedIndexes.map((variantIndex) => ({
					variant: variantIndex + 1,
					modelId: modelIds[variantIndex],
					message: `private provider detail ${variantIndex}`,
				})),
			),
		);
	});

	it("rejects an incomplete model configuration even when every dispatched call succeeds", async () => {
		mocks.variantModelIds.mockReturnValue(modelIds.slice(0, 2));
		mocks.generateCandidate.mockImplementation(
			async ({ variantIndex, modelId }) => candidateFor(variantIndex, modelId),
		);

		await expect(
			generateVerifiedHtml({
				apiKey: "key",
				env: {},
				modelId: modelIds[0],
				base64: "image-data",
				mediaType: "image/png",
				session,
			}),
		).rejects.toThrow("Analysis could not complete all three variants.");
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequest, createResponse } from "./routeTestUtils.js";

const mocks = vi.hoisted(() => ({
	createDebugSession: vi.fn(),
	writeDebugImage: vi.fn(),
	writeDebugJson: vi.fn(),
	writeDebugText: vi.fn(),
	categorizeHtmlForPalette: vi.fn(),
	processAnalysis: vi.fn(),
	processCategorization: vi.fn(),
}));

vi.mock("../../utils/debug.js", () => ({
	createDebugSession: mocks.createDebugSession,
	writeDebugImage: mocks.writeDebugImage,
	writeDebugJson: mocks.writeDebugJson,
	writeDebugText: mocks.writeDebugText,
}));
vi.mock("../../services/categorization.js", () => ({
	categorizeHtmlForPalette: mocks.categorizeHtmlForPalette,
}));
vi.mock("../../pipeline/analysis.js", () => ({
	processAnalysis: mocks.processAnalysis,
}));
vi.mock("../../pipeline/categorization.js", () => ({
	processCategorization: mocks.processCategorization,
}));

import { createAnalyzeRoute } from "../analyze.js";

const debugSession = {
	id: "debug-id",
	relativeDir: "debug/analysis/debug-id",
};
const recommendedVariant = {
	id: "variant-1",
	index: 1,
	modelId: "minimax/minimax-m3",
	html: "<main>generated</main>",
	issues: [],
	score: 92,
	visualEvaluation: { score: 92 },
	renderedScreenshot: { base64: "rendered", mediaType: "image/png" },
	frameFit: { fits: true },
	frameFitCorrected: false,
};

function completeAnalysis() {
	return {
		outcomes: [0, 1, 2].map((index) => ({
			index,
			status: "complete",
			variant: index === 0 ? recommendedVariant : { renderedScreenshot: {} },
		})),
		recommendedVariantIndex: 0,
		recommendedVariant,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.createDebugSession.mockResolvedValue(debugSession);
	mocks.writeDebugImage.mockResolvedValue(undefined);
	mocks.writeDebugJson.mockResolvedValue(undefined);
	mocks.writeDebugText.mockResolvedValue(undefined);
	mocks.processAnalysis.mockResolvedValue(completeAnalysis());
	mocks.categorizeHtmlForPalette.mockResolvedValue({
		html: "<main>categorized</main>",
		elements: [{ id: "main" }],
		semanticDebug: { semanticFallback: false },
	});
	mocks.processCategorization.mockImplementation(
		async (input, _context, dependencies) => {
			const categorized = await dependencies.services.categorizeHtmlForPalette(input);
			return { html: categorized.html, elements: categorized.elements };
		},
	);
});

describe("legacy analyze processor adapter", () => {
	it("returns the approved safe all-three failure with development debug identity", async () => {
		mocks.processAnalysis.mockResolvedValue({
			outcomes: [
				{ index: 0, status: "failed" },
				{ index: 1, status: "complete" },
				{ index: 2, status: "complete" },
			],
			recommendedVariantIndex: null,
			recommendedVariant: null,
		});
		const response = createResponse();

		await createAnalyzeRoute({ OPENROUTER_API_KEY: "key" })(
			createRequest({ body: { base64: "image-data" } }),
			response,
		);

		expect(response.statusCode).toBe(500);
		expect(response.json()).toEqual({
			error: "Analysis could not complete all three variants.",
			debugId: "debug-id",
			debugPath: "debug/analysis/debug-id",
		});
		expect(mocks.processCategorization).not.toHaveBeenCalled();
	});

	it("does not expose unexpected categorization details", async () => {
		mocks.processCategorization.mockRejectedValue(
			new Error("private categorization provider detail"),
		);
		const response = createResponse();

		await createAnalyzeRoute({ OPENROUTER_API_KEY: "key" })(
			createRequest({ body: { base64: "image-data" } }),
			response,
		);

		expect(response.statusCode).toBe(500);
		expect(response.text()).not.toContain("private categorization provider detail");
		expect(response.json()).toEqual({
			error: "Analysis failed.",
			debugId: "debug-id",
			debugPath: "debug/analysis/debug-id",
		});
		expect(mocks.writeDebugJson).toHaveBeenCalledWith(
			debugSession,
			"analysis-error.json",
			{ message: "private categorization provider detail" },
		);
	});

	it("preserves the combined response/debug schema with separate canonical contexts", async () => {
		const response = createResponse();
		await createAnalyzeRoute({
			OPENROUTER_API_KEY: "key",
			OPENROUTER_MODEL_ID: "ignored-server-override",
		})(
			createRequest({ body: { base64: "image-data", mediaType: "image/jpeg" } }),
			response,
		);

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			html: "<main>categorized</main>",
			elements: [{ id: "main" }],
			debug: {
				debugId: "debug-id",
				debugPath: "debug/analysis/debug-id",
				selectedVariant: 1,
				variantCount: 3,
				visualCorrected: false,
				frameFitCorrected: false,
				frameFit: { fits: true },
				visualScore: 92,
				visualVerificationAvailable: true,
				semanticFallback: false,
			},
		});
		const [analysisInput, analysisContext, analysisDependencies] =
			mocks.processAnalysis.mock.calls[0];
		const [categorizationInput, categorizationContext] =
			mocks.processCategorization.mock.calls[0];
		expect(analysisInput).toEqual({
			base64: "image-data",
			mediaType: "image/jpeg",
		});
		expect(categorizationInput).toEqual({
			html: "<main>generated</main>",
			base64: "image-data",
			mediaType: "image/jpeg",
		});
		expect(analysisContext.modelProfile.jobKind).toBe("analysis");
		expect(categorizationContext.modelProfile.jobKind).toBe("categorization");
		expect(categorizationContext.identity.attemptId).not.toBe(
			analysisContext.identity.attemptId,
		);
		expect(categorizationContext.providerLedger).not.toBe(
			analysisContext.providerLedger,
		);
		expect(JSON.stringify([analysisInput, analysisDependencies])).not.toContain(
			"ignored-server-override",
		);
		expect(mocks.writeDebugText).toHaveBeenCalledWith(
			debugSession,
			"generated.html",
			"<main>generated</main>",
		);
		expect(mocks.writeDebugJson).toHaveBeenCalledWith(
			debugSession,
			"final-result.json",
			{ html: "<main>categorized</main>", elements: [{ id: "main" }] },
		);
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	callOpenRouter: vi.fn(),
	callOpenRouterForProcessor: vi.fn(),
	parseOrRepair: vi.fn(),
	parseOrRepairForProcessor: vi.fn(),
	ProviderRequestError: class ProviderRequestError extends Error {},
	finalizeSemanticElements: vi.fn(),
	writeDebugJson: vi.fn(),
	writeDebugText: vi.fn(),
}));

vi.mock("../openRouter.js", () => ({
	ProviderRequestError: mocks.ProviderRequestError,
	callOpenRouter: mocks.callOpenRouter,
	callOpenRouterForProcessor: mocks.callOpenRouterForProcessor,
	parseOrRepair: mocks.parseOrRepair,
	parseOrRepairForProcessor: mocks.parseOrRepairForProcessor,
}));

vi.mock("../../utils/html.js", () => ({
	sanitizeGeneratedHtml: vi.fn((html) => `sanitized:${html}`),
}));

vi.mock("../../utils/elements.js", () => ({
	finalizeSemanticElements: mocks.finalizeSemanticElements,
}));

vi.mock("../../utils/debug.js", () => ({
	writeDebugJson: mocks.writeDebugJson,
	writeDebugText: mocks.writeDebugText,
}));

import { ProcessorCancelledError } from "../../shared/errors.js";
import { categorizeHtmlForPalette } from "../categorization.js";

const session = { id: "debug-id", relativeDir: "debug/analysis/debug-id" };
const input = {
	apiKey: "key",
	modelId: "server-model",
	html: "<main>source</main>",
	base64: "image-data",
	mediaType: "image/png",
	session,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.writeDebugJson.mockResolvedValue(undefined);
	mocks.writeDebugText.mockResolvedValue(undefined);
	mocks.finalizeSemanticElements.mockImplementation(
		(parsed) => parsed.elements,
	);
});

describe("categorization pre-extraction fallback characterization", () => {
	it.each([
		[
			"provider",
			() =>
				mocks.callOpenRouter.mockRejectedValue(
					new Error("provider unavailable"),
				),
		],
		[
			"parse/repair",
			() => {
				mocks.callOpenRouter.mockResolvedValue({
					text: "not json",
					data: { id: "response" },
				});
				mocks.parseOrRepair.mockRejectedValue(new Error("repair unavailable"));
			},
		],
	])("uses the documented degradable fallback after a %s failure", async (_name, arrange) => {
		arrange();
		mocks.finalizeSemanticElements.mockImplementation((parsed) =>
			parsed.elements.length === 0 ? [{ id: "fallback" }] : parsed.elements,
		);

		const result = await categorizeHtmlForPalette(input);

		expect(result).toEqual({
			html: "sanitized:<main>source</main>",
			elements: [{ id: "fallback" }],
			semanticDebug: {
				semanticFallback: true,
				semanticError:
					_name === "provider" ? "provider unavailable" : "repair unavailable",
			},
		});
		expect(mocks.writeDebugJson).toHaveBeenCalledWith(
			session,
			"semantic-error.json",
			expect.objectContaining({ message: expect.any(String) }),
		);
	});

	it("rethrows processor control flow before the context-aware fallback", async () => {
		const reason = new ProcessorCancelledError({ stage: "categorization" });
		mocks.callOpenRouterForProcessor.mockRejectedValue(reason);

		await expect(
			categorizeHtmlForPalette({
				...input,
				context: { signal: new AbortController().signal },
				provider: Object.freeze({ providerId: "openrouter" }),
				nextProviderRequestId: vi.fn(),
			}),
		).rejects.toBe(reason);
		expect(mocks.writeDebugJson).not.toHaveBeenCalled();
		expect(mocks.finalizeSemanticElements).not.toHaveBeenCalled();
	});

	it("preserves successful semantic output and repair diagnostics", async () => {
		mocks.callOpenRouter.mockResolvedValue({
			text: "broken semantic output",
			data: { id: "semantic-response" },
		});
		mocks.parseOrRepair.mockResolvedValue({
			parsed: { elements: [{ id: "semantic" }] },
			repaired: true,
			repairedText: '{"elements":[{"id":"semantic"}]}',
			repairData: { id: "repair-response" },
		});

		const result = await categorizeHtmlForPalette(input);

		expect(result).toEqual({
			html: "sanitized:<main>source</main>",
			elements: [{ id: "semantic" }],
			semanticDebug: { semanticFallback: false },
		});
		expect(mocks.writeDebugText).toHaveBeenCalledWith(
			session,
			"semantic-repaired-output.txt",
			'{"elements":[{"id":"semantic"}]}',
		);
		expect(mocks.writeDebugJson).toHaveBeenCalledWith(
			session,
			"semantic-repair-response.json",
			{ id: "repair-response" },
		);
	});
});

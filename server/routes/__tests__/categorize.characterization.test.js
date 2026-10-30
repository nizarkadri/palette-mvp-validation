import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequest, createResponse } from "./routeTestUtils.js";

const mocks = vi.hoisted(() => ({
	processCategorization: vi.fn(),
	categorizeHtmlForPalette: vi.fn(),
	createDebugSession: vi.fn(),
	writeDebugImage: vi.fn(),
	writeDebugJson: vi.fn(),
	writeDebugText: vi.fn(),
}));
vi.mock("../../pipeline/categorization.js", () => ({
	processCategorization: mocks.processCategorization,
}));
vi.mock("../../services/categorization.js", () => ({
	categorizeHtmlForPalette: mocks.categorizeHtmlForPalette,
}));
vi.mock("../../utils/debug.js", () => ({
	createDebugSession: mocks.createDebugSession,
	writeDebugImage: mocks.writeDebugImage,
	writeDebugJson: mocks.writeDebugJson,
	writeDebugText: mocks.writeDebugText,
}));

import { createCategorizeRoute } from "../categorize.js";

const session = { id: "debug-id", relativeDir: "debug/analysis/debug-id" };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.createDebugSession.mockResolvedValue(session);
	mocks.categorizeHtmlForPalette.mockResolvedValue({
		html: "<main>categorized</main>",
		elements: [{ id: "main" }],
		semanticDebug: { semanticFallback: false },
	});
	mocks.processCategorization.mockImplementation(
		async (input, _context, dependencies) => {
			const value = await dependencies.services.categorizeHtmlForPalette(input);
			return { html: value.html, elements: value.elements };
		},
	);
});

describe("categorization processor adapter", () => {
	it("preserves response/debug metadata and passes no raw model or HTTP objects", async () => {
		const response = createResponse();
		await createCategorizeRoute({
			OPENROUTER_API_KEY: "key",
			OPENROUTER_MODEL_ID: "ignored/env-model",
		})(
			createRequest({
				body: {
					html: "<main>generated</main>",
					base64: "image-data",
					mediaType: "image/jpeg",
					variantId: "variant-2",
				},
			}),
			response,
		);

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			html: "<main>categorized</main>",
			elements: [{ id: "main" }],
			debug: {
				debugId: "debug-id",
				debugPath: "debug/analysis/debug-id",
				variantId: "variant-2",
				semanticFallback: false,
			},
		});
		const [input, context, dependencies] =
			mocks.processCategorization.mock.calls[0];
		expect(input).toEqual({
			html: "<main>generated</main>",
			base64: "image-data",
			mediaType: "image/jpeg",
		});
		expect(context.modelProfile).toMatchObject({
			jobKind: "categorization",
			id: "default",
			provider: { modelId: "minimax/minimax-m3" },
		});
		expect(JSON.stringify([input, dependencies])).not.toContain(
			"ignored/env-model",
		);
		expect(input).not.toHaveProperty("req");
		expect(input).not.toHaveProperty("res");
		expect(mocks.writeDebugText).toHaveBeenCalledWith(
			session,
			"selected-variant.html",
			"<main>generated</main>",
		);
		expect(mocks.writeDebugJson).toHaveBeenCalledWith(
			session,
			"final-result.json",
			{ html: "<main>categorized</main>", elements: [{ id: "main" }] },
		);
	});
});

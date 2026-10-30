import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_MODEL_ID,
	GEMINI_IMAGE_VARIANT_MODEL_ID,
	GEMINI_LITE_IMAGE_VARIANT_MODEL_ID,
} from "../../constants.js";
import { createRequest, createResponse } from "./routeTestUtils.js";

const mocks = vi.hoisted(() => ({
	createDebugSession: vi.fn(),
	writeDebugImage: vi.fn(),
	writeDebugJson: vi.fn(),
	writeDebugText: vi.fn(),
	processImprovement: vi.fn(),
}));

vi.mock("../../utils/debug.js", () => ({
	createDebugSession: mocks.createDebugSession,
	writeDebugImage: mocks.writeDebugImage,
	writeDebugJson: mocks.writeDebugJson,
	writeDebugText: mocks.writeDebugText,
}));
vi.mock("../../pipeline/improvement.js", () => ({
	processImprovement: mocks.processImprovement,
}));

import { createImproveVariantRoute } from "../improve-variant.js";

const debugSession = {
	id: "debug-id",
	relativeDir: "debug/analysis/debug-id",
};

async function runRoute({ env = {}, modelId, includeModel = modelId !== undefined } = {}) {
	const response = createResponse();
	await createImproveVariantRoute({ OPENROUTER_API_KEY: "key", ...env })(
		createRequest({
			body: {
				html: "<main>source</main>",
				base64: "image-data",
				variantId: "source-id",
				...(includeModel ? { modelId } : {}),
			},
		}),
		response,
	);
	return response;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.createDebugSession.mockResolvedValue(debugSession);
	mocks.writeDebugImage.mockResolvedValue(undefined);
	mocks.writeDebugJson.mockResolvedValue(undefined);
	mocks.writeDebugText.mockResolvedValue(undefined);
	mocks.processImprovement.mockImplementation(async (_input, context) => ({
		id: "variant-1",
		index: 1,
		modelId: context.modelProfile.provider.modelId,
		html: "<main>improved</main>",
		issues: [],
		renderedScreenshot: { base64: "rendered", mediaType: "image/png" },
		frameFit: { fits: true },
	}));
});

describe("improvement model allowlist adapter", () => {
	it.each([
		[DEFAULT_MODEL_ID, "default"],
		[GEMINI_IMAGE_VARIANT_MODEL_ID, "gemini-image"],
		[GEMINI_LITE_IMAGE_VARIANT_MODEL_ID, "gemini-lite-image"],
	])("maps known raw model %s to canonical profile %s", async (modelId, profileId) => {
		const response = await runRoute({ modelId: `  ${modelId}  ` });
		const [input, context, dependencies] = mocks.processImprovement.mock.calls[0];

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			modelId,
			debug: {
				debugId: "debug-id",
				debugPath: "debug/analysis/debug-id",
				variantId: "source-id",
			},
		});
		expect(context.modelProfile).toMatchObject({
			id: profileId,
			jobKind: "improvement",
			provider: { modelId },
		});
		expect(input).toEqual({
			html: "<main>source</main>",
			base64: "image-data",
			mediaType: "image/png",
		});
		expect(input).not.toHaveProperty("modelId");
		expect(JSON.stringify(dependencies)).not.toContain(modelId);
		expect(mocks.writeDebugJson).toHaveBeenCalledWith(
			debugSession,
			"request-meta.json",
			expect.objectContaining({ modelId }),
		);
	});

	it.each([
		"Minimax/minimax-m3",
		`${DEFAULT_MODEL_ID}\u200b`,
		"unknown/model",
		"__proto__",
	])("rejects unknown/case/lookalike %j before processor or render dispatch", async (modelId) => {
		const response = await runRoute({ modelId });
		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({
			error: "Requested model is not available.",
		});
		expect(mocks.processImprovement).not.toHaveBeenCalled();
		expect(mocks.createDebugSession).not.toHaveBeenCalled();
	});

	it("rejects a configured but non-allowlisted environment model safely", async () => {
		const response = await runRoute({
			env: { OPENROUTER_MODEL_ID: "server-but-unknown/model" },
		});
		expect(response.statusCode).toBe(400);
		expect(mocks.processImprovement).not.toHaveBeenCalled();
	});

	it.each([
		["blank request with allowlisted env", "   ", true, GEMINI_IMAGE_VARIANT_MODEL_ID, GEMINI_IMAGE_VARIANT_MODEL_ID],
		["missing request with allowlisted env", undefined, false, GEMINI_LITE_IMAGE_VARIANT_MODEL_ID, GEMINI_LITE_IMAGE_VARIANT_MODEL_ID],
		["missing request and env", undefined, false, undefined, DEFAULT_MODEL_ID],
	])(
		"defaults canonically for %s",
		async (_name, modelId, includeModel, envModel, expected) => {
			const response = await runRoute({
				modelId,
				includeModel,
				env: envModel ? { OPENROUTER_MODEL_ID: envModel } : {},
			});
			expect(response.statusCode).toBe(200);
			expect(mocks.processImprovement.mock.calls[0][1].modelProfile.provider.modelId).toBe(expected);
		},
	);
});

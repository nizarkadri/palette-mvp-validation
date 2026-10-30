import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequest, createResponse } from "./routeTestUtils.js";

const mocks = vi.hoisted(() => ({ processCustomSwatchAnalysis: vi.fn() }));
vi.mock("../../pipeline/customSwatch.js", () => ({
	processCustomSwatchAnalysis: mocks.processCustomSwatchAnalysis,
}));

import { createCustomSwatchRoute } from "../custom-swatch.js";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.processCustomSwatchAnalysis.mockResolvedValue({
		intent: "choice",
		applicationMode: "softTintWithBorder",
		confidence: 1,
		rationale: "safe rationale",
	});
});

describe("custom-swatch processor adapter", () => {
	it("preserves the response schema and ignores arbitrary model env overrides", async () => {
		const response = createResponse();
		await createCustomSwatchRoute({
			OPENROUTER_API_KEY: "key",
			OPENROUTER_MODEL_ID: "client-like/env-override",
		})(
			createRequest({
				body: {
					base64: "image-data",
					mediaType: "image/jpeg",
					swatch: { label: "Brand" },
					elements: [{ id: "button" }],
					palette: { custom: "#123456" },
				},
			}),
			response,
		);

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			intent: "choice",
			applicationMode: "softTintWithBorder",
			confidence: 1,
			rationale: "safe rationale",
		});
		const [input, context, dependencies] =
			mocks.processCustomSwatchAnalysis.mock.calls[0];
		expect(input).toEqual({
			base64: "image-data",
			mediaType: "image/jpeg",
			swatch: { label: "Brand" },
			elements: [{ id: "button" }],
			palette: { custom: "#123456" },
		});
		expect(context.modelProfile).toMatchObject({
			jobKind: "custom-swatch",
			id: "default",
			provider: { modelId: "minimax/minimax-m3" },
		});
		expect(dependencies).toEqual({ apiKey: "key" });
		expect(JSON.stringify([input, dependencies])).not.toContain(
			"client-like/env-override",
		);
	});

	it("formats request cancellation as a safe failure with no success fallback", async () => {
		mocks.processCustomSwatchAnalysis.mockImplementation(async (_input, context) => {
			await new Promise((resolve) => {
				if (context.signal.aborted) resolve();
				else context.signal.addEventListener("abort", resolve, { once: true });
			});
			throw context.signal.reason;
		});
		const request = createRequest({ body: { base64: "image-data" } });
		const response = createResponse();
		const pending = createCustomSwatchRoute({ OPENROUTER_API_KEY: "key" })(
			request,
			response,
		);
		await vi.waitFor(() =>
			expect(mocks.processCustomSwatchAnalysis).toHaveBeenCalledTimes(1),
		);
		request.emit("aborted");
		await pending;

		expect(response.statusCode).toBe(500);
		expect(response.json()).toEqual({
			error: "Processor execution was cancelled.",
		});
		expect(request.listenerCount("aborted")).toBe(0);
	});
});

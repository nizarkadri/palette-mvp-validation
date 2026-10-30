import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequest, createResponse } from "./routeTestUtils.js";

const debugMocks = vi.hoisted(() => ({
	createDebugSession: vi.fn(),
	writeDebugImage: vi.fn(),
	writeDebugJson: vi.fn(),
	writeDebugText: vi.fn(),
}));

vi.mock("../../utils/debug.js", () => ({
	createDebugSession: debugMocks.createDebugSession,
	writeDebugImage: debugMocks.writeDebugImage,
	writeDebugJson: debugMocks.writeDebugJson,
	writeDebugText: debugMocks.writeDebugText,
}));

import { createAnalyzeRoute } from "../analyze.js";
import { createCategorizeRoute } from "../categorize.js";
import { createCustomSwatchRoute } from "../custom-swatch.js";
import { createImproveVariantRoute } from "../improve-variant.js";

beforeEach(() => {
	vi.clearAllMocks();
	debugMocks.createDebugSession.mockResolvedValue({
		id: "debug-id",
		relativeDir: "debug/analysis/debug-id",
	});
	debugMocks.writeDebugImage.mockResolvedValue(undefined);
	debugMocks.writeDebugJson.mockResolvedValue(undefined);
	debugMocks.writeDebugText.mockResolvedValue(undefined);
});

describe("legacy JSON route malformed-body characterization", () => {
	it.each([
		["categorize", createCategorizeRoute],
		["improve variant", createImproveVariantRoute],
		["custom swatch", createCustomSwatchRoute],
	])("keeps %s malformed JSON as a 500 JSON error", async (_name, createRoute) => {
		const response = createResponse();

		await createRoute({ OPENROUTER_API_KEY: "key" })(
			createRequest({ rawBody: "{" }),
			response,
		);

		expect(response.statusCode).toBe(500);
		expect(response.getHeader("content-type")).toBe("application/json");
		expect(response.json()).toEqual({ error: "Invalid JSON request body." });
	});

	it("keeps legacy analyze malformed JSON safe with debug identity", async () => {
		const response = createResponse();

		await createAnalyzeRoute({ OPENROUTER_API_KEY: "key" })(
			createRequest({ rawBody: "{" }),
			response,
		);

		expect(response.statusCode).toBe(500);
		expect(response.json()).toEqual({
			error: "Invalid JSON request body.",
			debugId: "debug-id",
			debugPath: "debug/analysis/debug-id",
		});
		expect(debugMocks.writeDebugJson).toHaveBeenCalledWith(
			{ id: "debug-id", relativeDir: "debug/analysis/debug-id" },
			"analysis-error.json",
			{ message: "Invalid JSON request body." },
		);
	});
});

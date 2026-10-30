import { describe, expect, it } from "vitest";
import { createAnalyzeStreamRoute } from "../analyze-stream.js";
import { createAnalyzeRoute } from "../analyze.js";
import { createCategorizeRoute } from "../categorize.js";
import { createCustomSwatchRoute } from "../custom-swatch.js";
import { createImproveVariantRoute } from "../improve-variant.js";
import { createRequest, createResponse } from "./routeTestUtils.js";

const routeFactories = [
	["analyze stream", createAnalyzeStreamRoute],
	["legacy analyze", createAnalyzeRoute],
	["categorize", createCategorizeRoute],
	["improve variant", createImproveVariantRoute],
	["custom swatch", createCustomSwatchRoute],
];

describe("legacy raw route compatibility", () => {
	it.each(
		routeFactories,
	)("keeps %s POST-only with the legacy JSON 405 response", async (_name, createRoute) => {
		const response = createResponse();

		await createRoute({ OPENROUTER_API_KEY: "key" })(
			createRequest({ method: "GET" }),
			response,
		);

		expect(response.statusCode).toBe(405);
		expect(response.getHeader("allow")).toBe("POST");
		expect(response.getHeader("content-type")).toBe("application/json");
		expect(response.json()).toEqual({ error: "Method not allowed." });
	});

	it.each(
		routeFactories,
	)("keeps %s missing-key failures before response streaming", async (_name, createRoute) => {
		const response = createResponse();

		await createRoute({})(createRequest({ body: {} }), response);

		expect(response.statusCode).toBe(500);
		expect(response.getHeader("content-type")).toBe("application/json");
		expect(response.json()).toEqual({
			error: "Missing OPENROUTER_API_KEY on the local server.",
		});
	});

	it("keeps malformed analyze-stream bodies as parseable NDJSON after setup", async () => {
		const response = createResponse();

		await createAnalyzeStreamRoute({ OPENROUTER_API_KEY: "key" })(
			createRequest({ rawBody: "{" }),
			response,
		);

		expect(response.statusCode).toBe(200);
		expect(response.getHeader("content-type")).toBe(
			"application/x-ndjson; charset=utf-8",
		);
		expect(response.getHeader("cache-control")).toBe("no-cache, no-transform");
		expect(response.getHeader("connection")).toBe("keep-alive");
		expect(response.ndjson()).toEqual([
			{ type: "error", error: "Invalid JSON request body." },
		]);
	});

	it("keeps missing analyze-stream image data as an NDJSON validation error", async () => {
		const response = createResponse();

		await createAnalyzeStreamRoute({ OPENROUTER_API_KEY: "key" })(
			createRequest({ body: {} }),
			response,
		);

		expect(response.statusCode).toBe(200);
		expect(response.ndjson()).toEqual([
			{ type: "error", error: "Missing screenshot image data." },
		]);
	});

	it.each([
		[
			"legacy analyze",
			createAnalyzeRoute,
			{},
			"Missing screenshot image data.",
		],
		["categorize", createCategorizeRoute, {}, "Missing generated HTML."],
		[
			"improve variant",
			createImproveVariantRoute,
			{},
			"Missing generated HTML.",
		],
		[
			"custom swatch",
			createCustomSwatchRoute,
			{},
			"Missing selected variant screenshot.",
		],
	])("keeps %s required-field validation", async (_name, createRoute, body, error) => {
		const response = createResponse();

		await createRoute({ OPENROUTER_API_KEY: "key" })(
			createRequest({ body }),
			response,
		);

		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({ error });
	});
});

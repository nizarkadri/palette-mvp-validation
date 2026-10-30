import { describe, expect, it, vi } from "vitest";
import { fetchHuemintAnchors, huemintInternals } from "../huemint.js";

function jsonResponse(body, init = {}) {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { "Content-Type": "application/json" },
	});
}

describe("Huemint color source", () => {
	it("creates an adjacency matrix with zero diagonal", () => {
		const matrix = huemintInternals.createAdjacencyMatrix(4);

		expect(matrix).toHaveLength(16);
		expect(matrix[0]).toBe("0");
		expect(matrix[5]).toBe("0");
		expect(matrix[10]).toBe("0");
		expect(matrix[15]).toBe("0");
	});

	it("creates locked palette slots for Huemint", () => {
		expect(huemintInternals.createLockedPalette(["#ffffff"], 4)).toEqual([
			"#ffffff",
			"-",
			"-",
			"-",
		]);
	});

	it("normalizes Huemint result palettes", () => {
		expect(
			huemintInternals.normalizeHuemintResults([
				{ palette: ["#ffffff", "#453735", "#d9503f", "#fcac6e"] },
			]),
		).toEqual([
			expect.objectContaining({
				source: "huemint",
				creativeColors: ["#ffffff", "#453735", "#d9503f", "#fcac6e"],
			}),
		]);
	});

	it("fetches transformer anchor palettes", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({
				results: [
					{
						palette: ["#ffffff", "#453735", "#d9503f", "#fcac6e"],
						score: -5.1,
					},
					{
						palette: ["#ffffff", "#1a3155", "#9263a4", "#2ccdd5"],
						score: -5.3,
					},
				],
			}),
		);

		const anchors = await fetchHuemintAnchors(
			{ count: 2, lockedColors: ["#ffffff"], creativity: "wild" },
			fetchImpl,
		);

		expect(anchors).toHaveLength(2);
		expect(anchors[0].source).toBe("huemint");
		expect(anchors[0].creativeColors).toEqual([
			"#ffffff",
			"#453735",
			"#d9503f",
			"#fcac6e",
		]);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [, request] = fetchImpl.mock.calls[0];
		expect(JSON.parse(request.body)).toEqual(
			expect.objectContaining({
				mode: "transformer",
				temperature: "1.7",
				num_results: 2,
			}),
		);
	});
});

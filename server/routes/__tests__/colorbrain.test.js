import { describe, expect, it, vi } from "vitest";
import { getColorBrainAnchorPalettes } from "../colorbrain.js";

function jsonResponse(body, init = {}) {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { "Content-Type": "application/json" },
	});
}

describe("ColorBrain anchors route service", () => {
	it("returns external anchors for a selected source", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({
				result: [
					[249, 249, 248],
					[195, 146, 215],
					[134, 93, 185],
					[152, 120, 168],
					[51, 36, 82],
				],
			}),
		);

		const result = await getColorBrainAnchorPalettes(
			{ source: "colormind", count: 2 },
			fetchImpl,
		);

		expect(result.anchorPalettes).toHaveLength(2);
		expect(result.anchorPalettes[0].source).toBe("colormind");
		expect(result.diagnostics.fallbackUsed).toBe(false);
	});

	it("uses local fallback when a selected external source fails", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({ error: "nope" }, { status: 500 }),
		);

		const result = await getColorBrainAnchorPalettes(
			{ source: "colormind", count: 3, seedColor: "#6366f1" },
			fetchImpl,
		);

		expect(result.anchorPalettes).toHaveLength(3);
		expect(
			result.anchorPalettes.every(
				(palette) => palette.source === "local-fallback",
			),
		).toBe(true);
		expect(result.diagnostics.fallbackUsed).toBe(true);
	});

	it("uses mixed successful sources and reports partial failures", async () => {
		const fetchImpl = vi.fn(async (url) => {
			if (String(url).includes("colormind")) {
				return jsonResponse({
					result: [
						[249, 249, 248],
						[195, 146, 215],
						[134, 93, 185],
						[152, 120, 168],
						[51, 36, 82],
					],
				});
			}
			return jsonResponse({ error: "failed" }, { status: 500 });
		});

		const result = await getColorBrainAnchorPalettes(
			{ source: "mixed", count: 2 },
			fetchImpl,
		);

		expect(result.anchorPalettes).toHaveLength(2);
		expect(
			result.anchorPalettes.every((palette) => palette.source === "colormind"),
		).toBe(true);
		expect(result.diagnostics.fallbackUsed).toBe(false);
		expect(result.diagnostics.failures).toBeGreaterThan(0);
	});
});

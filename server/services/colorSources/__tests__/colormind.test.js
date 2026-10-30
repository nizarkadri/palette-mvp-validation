import { describe, expect, it, vi } from "vitest";
import { colormindInternals, fetchColormindAnchors } from "../colormind.js";

function jsonResponse(body, init = {}) {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { "Content-Type": "application/json" },
	});
}

describe("Colormind color source", () => {
	it("maps locked colors into Colormind input slots", () => {
		expect(
			colormindInternals.createColormindInput(["#ff0000", "#00ff00"]),
		).toEqual([[255, 0, 0], [0, 255, 0], "N", "N", "N"]);
	});

	it("normalizes RGB API results into creative hex anchors", () => {
		expect(
			colormindInternals.normalizeColormindResult([
				[255, 0, 0],
				[0, 255, 0],
				[0, 0, 255],
			]),
		).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
	});

	it("fetches requested UI-model anchor palettes", async () => {
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

		const anchors = await fetchColormindAnchors(
			{ count: 2, lockedColors: ["#ffffff"] },
			fetchImpl,
		);

		expect(anchors).toHaveLength(2);
		expect(anchors[0]).toEqual(
			expect.objectContaining({
				source: "colormind",
				strategy: "ui-model",
				creativeColors: ["#f9f9f8", "#c392d7", "#865db9", "#9878a8", "#332452"],
			}),
		);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});

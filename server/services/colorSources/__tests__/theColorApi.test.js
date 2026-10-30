import { describe, expect, it, vi } from "vitest";
import {
	fetchTheColorApiAnchors,
	theColorApiInternals,
} from "../theColorApi.js";

function jsonResponse(body, init = {}) {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { "Content-Type": "application/json" },
	});
}

describe("The Color API source", () => {
	it("builds deterministic scheme URLs from a seed color", () => {
		const url = new URL(
			theColorApiInternals.buildSchemeUrl({
				seedColor: "#24B1E0",
				mode: "triad",
				count: 5,
			}),
		);

		expect(url.origin + url.pathname).toBe(
			"https://www.thecolorapi.com/scheme",
		);
		expect(url.searchParams.get("hex")).toBe("24b1e0");
		expect(url.searchParams.get("mode")).toBe("triad");
		expect(url.searchParams.get("count")).toBe("5");
	});

	it("extracts hex colors from scheme responses", () => {
		expect(
			theColorApiInternals.extractSchemeColors({
				colors: [
					{ hex: { value: "#C1239D" } },
					{ hex: { clean: "24B1E0" } },
					{ hex: { value: "#FACC15" } },
				],
			}),
		).toEqual(["#c1239d", "#24b1e0", "#facc15"]);
	});

	it("fetches harmony scheme anchors", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({
				colors: [
					{ hex: { value: "#C1239D" } },
					{ hex: { value: "#24B1E0" } },
					{ hex: { value: "#FACC15" } },
					{ hex: { value: "#111827" } },
					{ hex: { value: "#F8FAFC" } },
				],
			}),
		);

		const anchors = await fetchTheColorApiAnchors(
			{ count: 3, seedColor: "#24B1E0" },
			fetchImpl,
		);

		expect(anchors).toHaveLength(3);
		expect(anchors[0]).toEqual(
			expect.objectContaining({
				source: "the-color-api",
				creativeColors: ["#c1239d", "#24b1e0", "#facc15", "#111827", "#f8fafc"],
			}),
		);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});
});

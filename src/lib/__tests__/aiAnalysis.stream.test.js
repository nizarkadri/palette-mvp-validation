import { afterEach, describe, expect, it, vi } from "vitest";
import {
	analyzeScreenshotVariants,
	upsertVariantByIndex,
} from "../aiAnalysis.js";

const encoder = new TextEncoder();

function responseFromChunks(chunks, init = {}) {
	return new Response(
		new ReadableStream({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
				controller.close();
			},
		}),
		{
			status: init.status ?? 200,
			headers: { "Content-Type": "application/x-ndjson" },
		},
	);
}

function serializeEvents(events, trailingNewline = true) {
	return `${events.map((event) => JSON.stringify(event)).join("\n")}${
		trailingNewline ? "\n" : ""
	}`;
}

function validEvents() {
	return [
		{ type: "progress", progress: 8, message: "Generating 3 variants..." },
		{
			type: "variant.generated",
			variant: { id: "variant-1", index: 1, html: "<main>one</main>" },
		},
		{ type: "variant.evaluated", variantId: "variant-1", score: 90 },
		{
			type: "variant.generated",
			variant: { id: "variant-2", index: 2, html: "<main>two</main>" },
		},
		{ type: "variant.evaluated", variantId: "variant-2", score: 80 },
		{
			type: "variant.generated",
			variant: { id: "variant-3", index: 3, html: "<main>three</main>" },
		},
		{ type: "variant.evaluated", variantId: "variant-3", score: 70 },
		{
			type: "complete",
			recommendedVariantId: "variant-1",
			debug: { debugId: "debug-id" },
		},
	];
}

function stubEvents(events, { trailingNewline = true, splitAt = [] } = {}) {
	const payload = serializeEvents(events, trailingNewline);
	const boundaries = [0, ...splitAt, payload.length]
		.filter(
			(value, index, values) =>
				value >= 0 &&
				value <= payload.length &&
				values.indexOf(value) === index,
		)
		.sort((a, b) => a - b);
	const chunks = boundaries
		.slice(0, -1)
		.map((start, index) => payload.slice(start, boundaries[index + 1]));
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseFromChunks(chunks)));
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("analysis stream client terminal contract", () => {
	it("accepts chunk-split events only after three unique generated and evaluated variants", async () => {
		const events = validEvents();
		const payload = serializeEvents(events);
		stubEvents(events, {
			splitAt: [
				1,
				17,
				payload.indexOf("variant.generated") + 5,
				payload.length - 2,
			],
		});
		const handlers = {
			onProgress: vi.fn(),
			onVariant: vi.fn(),
			onVariantEvaluated: vi.fn(),
			onComplete: vi.fn(),
		};

		const result = await analyzeScreenshotVariants(
			"image-data",
			"image/png",
			handlers,
		);

		expect(result.variants.map((variant) => variant.index)).toEqual([1, 2, 3]);
		expect(
			result.variants.every((variant) => Array.isArray(variant.elements)),
		).toBe(true);
		expect(result.failedVariants).toEqual([]);
		expect(result.recommendedVariantId).toBe("variant-1");
		expect(result.debug).toEqual({ debugId: "debug-id" });
		expect(handlers.onVariant).toHaveBeenCalledTimes(3);
		expect(handlers.onVariantEvaluated).toHaveBeenCalledTimes(3);
		expect(handlers.onComplete).toHaveBeenCalledOnce();
	});

	it("sorts 3→2→1 arrival into stable result and UI index order", async () => {
		const events = [
			{ type: "progress", progress: 8 },
			...[
				[3, 70],
				[2, 80],
				[1, 90],
			].flatMap(([index, score]) => [
				{
					type: "variant.generated",
					variant: {
						id: `variant-${index}`,
						index,
						html: `<main>${index}</main>`,
					},
				},
				{ type: "variant.evaluated", variantId: `variant-${index}`, score },
			]),
			{ type: "complete", recommendedVariantId: "variant-1" },
		];
		stubEvents(events);
		let displayedVariants = [];

		const result = await analyzeScreenshotVariants("image-data", "image/png", {
			onVariant: (variant) => {
				displayedVariants = upsertVariantByIndex(displayedVariants, variant);
			},
		});

		expect(result.variants.map((variant) => variant.index)).toEqual([1, 2, 3]);
		expect(displayedVariants.map((variant) => variant.index)).toEqual([
			1, 2, 3,
		]);
	});

	it("accepts an unterminated final complete line", async () => {
		stubEvents(validEvents(), { trailingNewline: false });

		await expect(
			analyzeScreenshotVariants("image-data"),
		).resolves.toMatchObject({
			recommendedVariantId: "variant-1",
		});
	});

	it("rejects EOF without terminal complete", async () => {
		stubEvents(validEvents().slice(0, -1));

		await expect(analyzeScreenshotVariants("image-data")).rejects.toThrow(
			"Analysis stream ended before terminal complete.",
		);
	});

	it("rejects an explicit terminal error after a variant failure", async () => {
		stubEvents([
			{
				type: "variant.failed",
				variantId: "variant-2",
				index: 2,
				error: "Variant generation failed.",
			},
			{
				type: "error",
				error: "Analysis could not complete all three variants.",
			},
		]);

		await expect(analyzeScreenshotVariants("image-data")).rejects.toThrow(
			"Analysis could not complete all three variants.",
		);
	});

	it("rejects evaluation before matching generation without signaling completion", async () => {
		const events = validEvents();
		[events[1], events[2]] = [events[2], events[1]];
		stubEvents(events);
		const onComplete = vi.fn();

		await expect(
			analyzeScreenshotVariants("image-data", "image/png", { onComplete }),
		).rejects.toThrow("Analysis stream evaluated a variant before generation.");
		expect(onComplete).not.toHaveBeenCalled();
	});

	it("rejects any meaningful event after complete without signaling completion", async () => {
		const events = validEvents();
		events.push({ type: "progress", progress: 100 });
		stubEvents(events);
		const onComplete = vi.fn();

		await expect(
			analyzeScreenshotVariants("image-data", "image/png", { onComplete }),
		).rejects.toThrow(
			"Analysis stream completed without exactly three evaluated variants.",
		);
		expect(onComplete).not.toHaveBeenCalled();
	});

	it("rejects malformed events", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(responseFromChunks(["{not-json}\n"])),
		);

		await expect(analyzeScreenshotVariants("image-data")).rejects.toThrow(
			"Analysis stream failed: invalid server event.",
		);
	});

	it.each([
		[
			"missing index",
			(events) => {
				delete events[1].variant.index;
			},
		],
		[
			"duplicate index",
			(events) => {
				events[5].variant.index = 2;
			},
		],
		[
			"out-of-range index",
			(events) => {
				events[5].variant.index = 4;
			},
		],
		[
			"duplicate generated ID",
			(events) => {
				events[5].variant.id = "variant-2";
			},
		],
		[
			"missing evaluation",
			(events) => {
				events.splice(6, 1);
			},
		],
		[
			"duplicate evaluation",
			(events) => {
				events.splice(6, 0, {
					type: "variant.evaluated",
					variantId: "variant-2",
				});
			},
		],
		[
			"failed variant followed by complete",
			(events) => {
				events.splice(7, 0, {
					type: "variant.failed",
					variantId: "variant-3",
					index: 3,
					error: "Variant generation failed.",
				});
			},
		],
		[
			"duplicate complete",
			(events) => {
				events.push({
					type: "complete",
					recommendedVariantId: "variant-1",
				});
			},
		],
	])("rejects a terminal stream with %s", async (_name, mutate) => {
		const events = validEvents();
		mutate(events);
		stubEvents(events);
		const onComplete = vi.fn();

		await expect(
			analyzeScreenshotVariants("image-data", "image/png", { onComplete }),
		).rejects.toThrow(
			"Analysis stream completed without exactly three evaluated variants.",
		);
		expect(onComplete).not.toHaveBeenCalled();
	});

	it("preserves non-stream HTTP error messages", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ error: "Request rejected." }), {
					status: 400,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);

		await expect(analyzeScreenshotVariants("image-data")).rejects.toThrow(
			"Request rejected.",
		);
	});
});

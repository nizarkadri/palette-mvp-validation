import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadModule } from "./testUtils.js";

let queueModule;

beforeAll(async () => {
	queueModule = await loadModule("../paletteQueue.js");
});

describe("colorBrain snappy palette queue", () => {
	function makePalette(index) {
		return {
			name: `Palette ${index}`,
			primary: "#ffffff",
			secondary: "#f8fafc",
			accent: "#6366f1",
			text: "#111827",
			textMuted: "#64748b",
			onAccent: "#ffffff",
		};
	}

	it("returns the next palette synchronously without waiting for refill work", async () => {
		vi.useFakeTimers();
		const refill = vi.fn(
			() =>
				new Promise((resolve) => {
					setTimeout(
						() =>
							resolve(
								Array.from({ length: 10 }, (_, i) => makePalette(i + 10)),
							),
						100,
					);
				}),
		);
		const queue = queueModule.createPaletteQueue({
			initialPalettes: Array.from({ length: 5 }, (_, i) => makePalette(i)),
			lowWatermark: 3,
			refill,
		});

		const first = queue.next();
		const second = queue.next();
		const third = queue.next();

		expect(first.name).toBe("Palette 0");
		expect(second.name).toBe("Palette 1");
		expect(third.name).toBe("Palette 2");
		expect(refill).toHaveBeenCalledTimes(1);

		// Refill should not be required for the immediate keypress path.
		expect(queue.size()).toBeGreaterThan(0);

		await vi.runAllTimersAsync();
		expect(queue.size()).toBeGreaterThanOrEqual(10);
		vi.useRealTimers();
	});

	it("falls back to looping existing palettes if refill has not completed", () => {
		vi.useFakeTimers();
		const refill = vi.fn(
			() =>
				new Promise((resolve) => {
					setTimeout(() => resolve([makePalette(99)]), 1000);
				}),
		);
		const queue = queueModule.createPaletteQueue({
			initialPalettes: [makePalette(0), makePalette(1)],
			lowWatermark: 2,
			refill,
		});

		const seen = Array.from({ length: 8 }, () => queue.next().name);

		expect(seen).toEqual([
			"Palette 0",
			"Palette 1",
			"Palette 0",
			"Palette 1",
			"Palette 0",
			"Palette 1",
			"Palette 0",
			"Palette 1",
		]);
		expect(refill).toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("does not start multiple concurrent refills while the first one is pending", () => {
		vi.useFakeTimers();
		const refill = vi.fn(
			() =>
				new Promise((resolve) => {
					setTimeout(() => resolve([makePalette(9), makePalette(10)]), 100);
				}),
		);
		const queue = queueModule.createPaletteQueue({
			initialPalettes: [makePalette(0), makePalette(1), makePalette(2)],
			lowWatermark: 3,
			refill,
		});

		queue.next();
		queue.next();
		queue.next();
		queue.next();

		expect(refill).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});
});

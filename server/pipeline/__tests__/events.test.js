import { describe, expect, it, vi } from "vitest";
import {
	PROCESSOR_EVENT_TYPES,
	PROCESSOR_EVENT_VERSION,
	createContextProcessorEventStream,
	createProcessorEventStream,
	createProcessorProgressAggregator,
	validateProcessorEvent,
} from "../events.js";
import { createContextFixture } from "../../shared/__tests__/testUtils.js";

async function emitSuccessfulAnalysis(stream, order = [0, 1, 2]) {
	for (const variantIndex of order) {
		await stream.generation({
			variantIndex,
			output: { html: `<main>${variantIndex}</main>` },
		});
	}
	for (const variantIndex of order) {
		await stream.evaluation({
			variantIndex,
			evaluation: { score: 90 - variantIndex },
		});
	}
	return stream.completion({
		recommendedVariantIndex: 0,
		result: { selected: 0 },
	});
}

describe("processor event contracts", () => {
	it("emits versioned, deeply frozen, transport-neutral contracts", async () => {
		const events = [];
		const source = { html: "<main>safe</main>", nested: { issues: [] } };
		const stream = createProcessorEventStream({
			variantCount: 1,
			emitProcessorEvent: (event) => events.push(event),
		});

		const generatedPromise = stream.generation({ variantIndex: 0, output: source });
		source.nested.issues.push("changed later");
		const generated = await generatedPromise;
		await stream.evaluation({ variantIndex: 0, evaluation: { score: 91 } });
		await stream.completion({
			recommendedVariantIndex: 0,
			result: { artifactId: "artifact-1" },
		});

		expect(events.map(({ version, type }) => ({ version, type }))).toEqual([
			{ version: PROCESSOR_EVENT_VERSION, type: "generation" },
			{ version: PROCESSOR_EVENT_VERSION, type: "evaluation" },
			{ version: PROCESSOR_EVENT_VERSION, type: "completion" },
		]);
		expect(generated.output.nested.issues).toEqual([]);
		expect(Object.isFrozen(generated)).toBe(true);
		expect(Object.isFrozen(generated.output.nested.issues)).toBe(true);
		for (const event of events) {
			expect(event).not.toHaveProperty("percent");
			expect(JSON.stringify(event)).not.toMatch(
				/http|ndjson|express|firestore|cloud.?tasks/i,
			);
		}
	});

	it("preserves causal order per variant while allowing cross-variant interleaving", async () => {
		const events = [];
		const stream = createProcessorEventStream({
			emitProcessorEvent: (event) => events.push(event),
		});

		const deliveries = [
			stream.generation({ variantIndex: 2, output: { id: "v2" } }),
			stream.generation({ variantIndex: 0, output: { id: "v0" } }),
			stream.evaluation({ variantIndex: 2, evaluation: { score: 80 } }),
			stream.generation({ variantIndex: 1, output: { id: "v1" } }),
			stream.evaluation({ variantIndex: 1, evaluation: { score: 85 } }),
			stream.evaluation({ variantIndex: 0, evaluation: { score: 90 } }),
			stream.completion({ recommendedVariantIndex: 0, result: {} }),
		];
		await Promise.all(deliveries);

		expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		for (const variantIndex of [0, 1, 2]) {
			expect(
				events
					.filter((event) => event.variantIndex === variantIndex)
					.map((event) => [event.type, event.variantSequence]),
			).toEqual([
				[PROCESSOR_EVENT_TYPES.GENERATION, 1],
				[PROCESSOR_EVENT_TYPES.EVALUATION, 2],
			]);
		}
	});

	it("rejects non-causal variant and completion events", () => {
		const stream = createProcessorEventStream({ emitProcessorEvent: vi.fn() });

		expect(() =>
			stream.evaluation({ variantIndex: 0, evaluation: {} }),
		).toThrow("Evaluation must follow generation");
		stream.generation({ variantIndex: 0, output: {} });
		expect(() => stream.generation({ variantIndex: 0, output: {} })).toThrow(
			"Generation must be the first event",
		);
		expect(() =>
			stream.completion({ recommendedVariantIndex: 0, result: {} }),
		).toThrow("requires every variant");
	});

	it("supports canonical failures without retaining raw error details", async () => {
		const events = [];
		const stream = createProcessorEventStream({
			variantCount: 2,
			emitProcessorEvent: (event) => events.push(event),
		});

		await stream.failure({
			variantIndex: 0,
			stage: "generation",
			code: " provider_failed ",
			retryable: true,
		});
		await stream.generation({ variantIndex: 1, output: {} });
		await stream.failure({
			variantIndex: 1,
			stage: "evaluation",
			code: "render_failed",
			retryable: false,
		});

		expect(events).toMatchObject([
			{
				type: "failure",
				variantSequence: 1,
				code: "PROVIDER_FAILED",
				safeMessage: "Variant generation failed.",
			},
			{ type: "generation" },
			{
				type: "failure",
				variantSequence: 2,
				code: "RENDER_FAILED",
				safeMessage: "Variant evaluation failed.",
			},
		]);
		expect(JSON.stringify(events)).not.toContain("provider secret");
		expect(() =>
			stream.completion({ recommendedVariantIndex: 1, result: {} }),
		).toThrow("requires every variant");
	});

	it.each([
		["wrong version", { version: 2 }, "event.version"],
		["unknown type", { type: "progress" }, "event.type"],
		["global percent", { percent: 50 }, "event.percent"],
		["invalid index", { variantIndex: 3 }, "variantIndex"],
		["non-JSON payload", { output: { invalid: undefined } }, "JSON-like"],
	])("rejects malformed generation events: %s", (_name, override, message) => {
		const event = {
			version: 1,
			type: "generation",
			sequence: 1,
			variantIndex: 0,
			variantSequence: 1,
			output: {},
			...override,
		};
		expect(() => validateProcessorEvent(event)).toThrow(message);
	});

	it("rejects unsafe object shapes, cycles, and forged failure messages", () => {
		const cyclic = {};
		cyclic.self = cyclic;
		const event = {
			version: 1,
			type: "generation",
			sequence: 1,
			variantIndex: 0,
			variantSequence: 1,
			output: cyclic,
		};
		expect(() => validateProcessorEvent(event)).toThrow("cycles");

		const forgedFailure = {
			version: 1,
			type: "failure",
			sequence: 1,
			variantIndex: 0,
			variantSequence: 1,
			stage: "generation",
			code: "FAILED",
			retryable: false,
			safeMessage: "secret API key",
		};
		expect(() => validateProcessorEvent(forgedFailure)).toThrow(
			"canonical safe message",
		);
	});

	it("does not advance causal state when an input fails validation", async () => {
		const emitProcessorEvent = vi.fn();
		const stream = createProcessorEventStream({ emitProcessorEvent });

		expect(() =>
			stream.generation({ variantIndex: 0, output: { bad: undefined } }),
		).toThrow("JSON-like");
		expect(() =>
			stream.failure({
				variantIndex: 1,
				stage: "generation",
				code: "caller secret is not a code",
			}),
		).toThrow("safe symbolic code");
		await expect(
			stream.generation({ variantIndex: 0, output: { valid: true } }),
		).resolves.toMatchObject({ type: "generation" });
		await expect(
			stream.failure({
				variantIndex: 1,
				stage: "generation",
				code: "PROVIDER_FAILED",
				retryable: true,
			}),
		).resolves.toMatchObject({ type: "failure" });
		expect(() =>
			stream.failure({
				variantIndex: 0,
				stage: "evaluation",
				code: "not-valid!",
			}),
		).toThrow("safe symbolic code");
		await expect(
			stream.failure({
				variantIndex: 0,
				stage: "evaluation",
				code: "RENDER_FAILED",
				retryable: false,
			}),
		).resolves.toMatchObject({ type: "failure" });
		expect(emitProcessorEvent).toHaveBeenCalledTimes(3);
	});

	it("awaits and globally serializes async event and progress transports", async () => {
		const trace = [];
		const { stream } = createContextProcessorEventStream(
			createContextFixture({
				emitProcessorEvent: async (event) => {
					trace.push(`event-${event.sequence}-start`);
					await new Promise((resolve) => setTimeout(resolve, 2));
					trace.push(`event-${event.sequence}-end`);
				},
				reportProgress: async (_stage, percent) => {
					trace.push(`progress-${percent}-start`);
					await new Promise((resolve) => setTimeout(resolve, 2));
					trace.push(`progress-${percent}-end`);
				},
			}),
			{ variantCount: 1 },
		);

		const deliveries = [
			stream.generation({ variantIndex: 0, output: {} }),
			stream.evaluation({ variantIndex: 0, evaluation: {} }),
			stream.completion({ recommendedVariantIndex: 0, result: {} }),
		];
		await Promise.all(deliveries);

		expect(trace).toEqual([
			"event-1-start",
			"event-1-end",
			"progress-45-start",
			"progress-45-end",
			"event-2-start",
			"event-2-end",
			"progress-90-start",
			"progress-90-end",
			"event-3-start",
			"event-3-end",
			"progress-100-start",
			"progress-100-end",
		]);
	});

	it("propagates async transport rejection and blocks queued completion", async () => {
		const expected = new Error("event persistence failed");
		const delivered = [];
		const stream = createProcessorEventStream({
			variantCount: 1,
			emitProcessorEvent: async (event) => {
				delivered.push(event.type);
				if (event.type === "evaluation") throw expected;
			},
		});
		const generation = stream.generation({ variantIndex: 0, output: {} });
		const evaluation = stream.evaluation({ variantIndex: 0, evaluation: {} });
		const completion = stream.completion({
			recommendedVariantIndex: 0,
			result: {},
		});

		await expect(generation).resolves.toMatchObject({ type: "generation" });
		await expect(evaluation).rejects.toBe(expected);
		await expect(completion).rejects.toBe(expected);
		expect(delivered).toEqual(["generation", "evaluation"]);
	});
});

describe("processor progress aggregation", () => {
	it("is the only component that reports bounded monotonic global progress", async () => {
		const reportProgress = vi.fn();
		const events = [];
		const streamWithoutAggregator = createProcessorEventStream({
			emitProcessorEvent: (event) => events.push(event),
		});
		await emitSuccessfulAnalysis(streamWithoutAggregator, [2, 0, 1]);
		expect(reportProgress).not.toHaveBeenCalled();

		const aggregator = createProcessorProgressAggregator({ reportProgress });
		const snapshots = [];
		for (const event of events) snapshots.push(await aggregator.consume(event));
		const percents = snapshots.map(({ percent }) => percent);

		expect(percents).toEqual([15, 30, 45, 60, 75, 90, 100]);
		expect(percents.every((percent) => percent >= 0 && percent <= 100)).toBe(
			true,
		);
		expect([...percents].sort((a, b) => a - b)).toEqual(percents);
		expect(aggregator.snapshot()).toEqual({ percent: 100, completed: true });
		expect(reportProgress).toHaveBeenCalledTimes(events.length);
	});

	it("derives deterministic percentages from aggregate state including failures", async () => {
		async function aggregate() {
			const events = [];
			const reports = [];
			const stream = createProcessorEventStream({
				emitProcessorEvent: (event) => events.push(event),
			});
			await stream.generation({ variantIndex: 2, output: {} });
			await stream.failure({
				variantIndex: 0,
				stage: "generation",
				code: "PROVIDER_FAILED",
				retryable: true,
			});
			await stream.failure({
				variantIndex: 2,
				stage: "evaluation",
				code: "RENDER_FAILED",
				retryable: false,
			});
			await stream.generation({ variantIndex: 1, output: {} });
			await stream.evaluation({ variantIndex: 1, evaluation: {} });
			const aggregator = createProcessorProgressAggregator({
				reportProgress: (...report) => reports.push(report),
			});
			for (const event of events) await aggregator.consume(event);
			return reports;
		}

		const first = await aggregate();
		expect(await aggregate()).toEqual(first);
		expect(first.map(([, percent]) => percent)).toEqual([15, 45, 60, 75, 90]);
	});

	it("never copies payloads, failure codes, or caller text into progress", async () => {
		const reports = [];
		const secret = "sk-private-provider-secret";
		const { stream } = createContextProcessorEventStream(
			createContextFixture({
				emitProcessorEvent: vi.fn(),
				reportProgress: (...report) => reports.push(report),
			}),
			{ variantCount: 1 },
		);

		await stream.generation({ variantIndex: 0, output: { html: secret } });
		await stream.failure({
			variantIndex: 0,
			stage: "evaluation",
			code: "PRIVATE_PROVIDER_SECRET",
			retryable: false,
		});

		expect(reports).toEqual([
			["generation", 45, "Variant generation completed."],
			["processing", 90, "Variant processing finished safely."],
		]);
		expect(JSON.stringify(reports)).not.toContain(secret);
		expect(JSON.stringify(reports)).not.toContain("PRIVATE_PROVIDER_SECRET");
	});

	it("rejects malformed, duplicate, skipped, and post-completion events before reporting", async () => {
		const reportProgress = vi.fn();
		const aggregator = createProcessorProgressAggregator({
			reportProgress,
			variantCount: 1,
		});
		const events = [];
		const stream = createProcessorEventStream({
			variantCount: 1,
			emitProcessorEvent: (event) => events.push(event),
		});
		await emitSuccessfulAnalysis(stream, [0]);

		expect(() => aggregator.consume({ ...events[0], sequence: 2 })).toThrow(
			"sequence is not contiguous",
		);
		expect(reportProgress).not.toHaveBeenCalled();
		await aggregator.consume(events[0]);
		expect(() => aggregator.consume(events[0])).toThrow(
			"sequence is not contiguous",
		);
		await aggregator.consume(events[1]);
		await aggregator.consume(events[2]);
		expect(() => aggregator.consume({ ...events[2], sequence: 4 })).toThrow(
			"after completion",
		);
		expect(reportProgress).toHaveBeenCalledTimes(3);
	});
});

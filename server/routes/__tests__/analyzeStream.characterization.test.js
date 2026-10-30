import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	PROVIDER_FAILURE_CODES,
	ProviderRequestError,
} from "../../services/openRouter.js";
import { createRequest, createResponse } from "./routeTestUtils.js";

const mocks = vi.hoisted(() => ({
	createDebugSession: vi.fn(),
	writeDebugImage: vi.fn(),
	writeDebugJson: vi.fn(),
	processAnalysis: vi.fn(),
}));

vi.mock("../../utils/debug.js", () => ({
	createDebugSession: mocks.createDebugSession,
	writeDebugImage: mocks.writeDebugImage,
	writeDebugJson: mocks.writeDebugJson,
}));

vi.mock("../../pipeline/analysis.js", () => ({
	processAnalysis: mocks.processAnalysis,
}));

import { createAnalyzeStreamRoute } from "../analyze-stream.js";

const debugSession = {
	id: "debug-id",
	relativeDir: "debug/analysis/debug-id",
};

function variant(index) {
	return {
		id: `variant-${index + 1}`,
		index: index + 1,
		modelId: `canonical-model-${index}`,
		html: `<main>${index}</main>`,
		issues: [],
		score: 90 - index,
		visualEvaluation: null,
		renderedScreenshot: {
			base64: `image-${index}`,
			mediaType: "image/png",
			relativePath: `debug/variant-${index + 1}.png`,
		},
		frameFit: { fits: true },
		frameFitCorrected: false,
	};
}

async function deliver(context, event, percent) {
	await context.emitProcessorEvent(event);
	await context.reportProgress("processing", percent, "safe progress");
}

function successfulProcessor(order = [2, 1, 0]) {
	return async (_input, context) => {
		let sequence = 0;
		const outcomes = [];
		for (const index of order) {
			const output = variant(index);
			sequence += 1;
			await deliver(
				context,
				{ type: "generation", variantIndex: index, output, sequence },
				20 + sequence * 10,
			);
			sequence += 1;
			const evaluation = { score: 90 - index, pass: true };
			await deliver(
				context,
				{ type: "evaluation", variantIndex: index, evaluation, sequence },
				20 + sequence * 10,
			);
			outcomes.push({ index, status: "complete", variant: output });
		}
		sequence += 1;
		await deliver(
			context,
			{
				type: "completion",
				recommendedVariantIndex: 0,
				sequence,
			},
			100,
		);
		return {
			outcomes: outcomes.sort((left, right) => left.index - right.index),
			recommendedVariantIndex: 0,
			recommendedVariant: variant(0),
		};
	};
}

async function runRoute({ request } = {}) {
	const response = createResponse();
	const req =
		request ||
		createRequest({ body: { base64: "image-data", mediaType: "image/png" } });
	await createAnalyzeStreamRoute({
		OPENROUTER_API_KEY: "key",
		OPENROUTER_MODEL_ID: "ignored-arbitrary-env-model",
	})(req, response);
	return { response, request: req };
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.createDebugSession.mockResolvedValue(debugSession);
	mocks.writeDebugImage.mockResolvedValue(undefined);
	mocks.writeDebugJson.mockResolvedValue(undefined);
	mocks.processAnalysis.mockImplementation(successfulProcessor());
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("analyze-stream processor adapter", () => {
	it("maps parseable causal NDJSON and keeps complete last with no post-complete progress", async () => {
		const { response } = await runRoute();
		const events = response.ndjson();

		expect(events[0]).toEqual({
			type: "progress",
			message: "Generating 3 variants...",
			progress: 8,
		});
		expect(events.at(-1)).toEqual({
			type: "complete",
			recommendedVariantId: "variant-1",
			debug: {
				debugId: "debug-id",
				debugPath: "debug/analysis/debug-id",
			},
			progress: 100,
		});
		expect(events.filter(({ type }) => type === "variant.generated").map(({ variant }) => variant.id)).toEqual([
			"variant-3",
			"variant-2",
			"variant-1",
		]);
		for (const id of ["variant-1", "variant-2", "variant-3"]) {
			const generatedAt = events.findIndex(
				(event) => event.type === "variant.generated" && event.variant.id === id,
			);
			const evaluatedAt = events.findIndex(
				(event) => event.type === "variant.evaluated" && event.variantId === id,
			);
			expect(evaluatedAt).toBeGreaterThan(generatedAt);
			expect(events[generatedAt].progress).toEqual(expect.any(Number));
			expect(events[evaluatedAt].progress).toEqual(expect.any(Number));
		}
		expect(events.slice(events.findIndex(({ type }) => type === "complete") + 1)).toEqual([]);
	});

	it.each([1, 2, 3])(
		"emits stable indexed failures then a safe error and no complete for %s failure(s)",
		async (failureCount) => {
			mocks.processAnalysis.mockImplementation(async (_input, context) => {
				const outcomes = [];
				for (let index = 0; index < 3; index += 1) {
					if (index < failureCount) {
						await deliver(
							context,
							{ type: "failure", variantIndex: index, stage: "generation" },
							15 + index * 10,
						);
						outcomes.push({
							index,
							status: "failed",
							safeMessage: "Variant generation failed.",
						});
					} else {
						outcomes.push({ index, status: "complete", variant: variant(index) });
					}
				}
				return { outcomes, recommendedVariantIndex: null, recommendedVariant: null };
			});

			const { response } = await runRoute();
			const events = response.ndjson();
			const failures = events.filter(({ type }) => type === "variant.failed");
			expect(failures.map(({ index }) => index)).toEqual(
				Array.from({ length: failureCount }, (_, index) => index + 1),
			);
			expect(events.some(({ type }) => type === "complete")).toBe(false);
			expect(events.at(-1)).toEqual({
				type: "error",
				error: "Analysis could not complete all three variants.",
			});
		},
	);

	it("passes only validated input, dependencies, and a complete immutable local context", async () => {
		await runRoute();
		const [input, context, dependencies] = mocks.processAnalysis.mock.calls[0];
		expect(input).toEqual({ base64: "image-data", mediaType: "image/png" });
		expect(input).not.toHaveProperty("modelId");
		expect(context).toMatchObject({
			signal: expect.any(AbortSignal),
			applicationDeadlineAt: expect.any(Number),
			absoluteJobDeadlineAt: expect.any(Number),
			effectiveDeadlineAt: expect.any(Number),
			modelProfile: { jobKind: "analysis", id: "default" },
			providerLedger: { attemptId: context.providerLedger.attemptId },
			reportProgress: expect.any(Function),
			emitProcessorEvent: expect.any(Function),
			artifactStore: { create: expect.any(Function) },
			checkpointStore: { createCompleted: expect.any(Function) },
		});
		expect(Object.isFrozen(context)).toBe(true);
		expect(context.signal.aborted).toBe(false);
		expect(context.providerLedger.snapshot().limits).toEqual(
			context.modelProfile.attemptLedgerCeilings,
		);
		expect(dependencies).toEqual({
			apiKey: "key",
			services: expect.any(Object),
		});
		expect(JSON.stringify([input, dependencies])).not.toContain(
			"ignored-arbitrary-env-model",
		);
		expect(input).not.toHaveProperty("req");
		expect(input).not.toHaveProperty("res");
	});

	it("turns request abort/control-flow into one safe terminal error and removes the listener", async () => {
		mocks.processAnalysis.mockImplementation(async (_input, context) => {
			await new Promise((resolve) => {
				if (context.signal.aborted) resolve();
				else context.signal.addEventListener("abort", resolve, { once: true });
			});
			throw context.signal.reason;
		});
		const request = createRequest({ body: { base64: "image-data" } });
		const response = createResponse();
		const pending = createAnalyzeStreamRoute({ OPENROUTER_API_KEY: "key" })(
			request,
			response,
		);
		await vi.waitFor(() => expect(mocks.processAnalysis).toHaveBeenCalledTimes(1));
		request.emit("aborted");
		await pending;

		expect(response.ndjson().at(-1)).toEqual({
			type: "error",
			error: "Analysis failed.",
		});
		expect(response.ndjson().some(({ type }) => type === "complete")).toBe(false);
		expect(request.listenerCount("aborted")).toBe(0);
		expect(response.listenerCount("close")).toBe(0);
	});

	it("cancels in-flight work on a premature response close after body parsing", async () => {
		mocks.processAnalysis.mockImplementation(async (_input, context) => {
			await new Promise((resolve) => {
				if (context.signal.aborted) resolve();
				else context.signal.addEventListener("abort", resolve, { once: true });
			});
			throw context.signal.reason;
		});
		const request = createRequest({ body: { base64: "image-data" } });
		const response = createResponse();
		const pending = createAnalyzeStreamRoute({ OPENROUTER_API_KEY: "key" })(
			request,
			response,
		);
		await vi.waitFor(() => expect(mocks.processAnalysis).toHaveBeenCalledTimes(1));

		response.emit("close");
		await pending;

		expect(response.ndjson().at(-1)).toEqual({
			type: "error",
			error: "Analysis failed.",
		});
		expect(response.listenerCount("close")).toBe(0);
		expect(request.listenerCount("aborted")).toBe(0);
	});

	it("writes the deepest private provider cause only to development debug JSON", async () => {
		const privateDetail = "private upstream provider payload detail";
		mocks.processAnalysis.mockImplementation(async (_input, context) => {
			await context.diagnostics.record({
				severity: "warn",
				stage: "generation",
				code: "PROVIDER_FAILED",
				variantIndex: 1,
				error: new ProviderRequestError(PROVIDER_FAILURE_CODES.TRANSPORT, {
					cause: new Error("provider wrapper", {
						cause: new Error(privateDetail),
					}),
				}),
			});
			return {
				outcomes: [
					{ index: 0, status: "complete", variant: variant(0) },
					{
						index: 1,
						status: "failed",
						safeMessage: "Variant generation failed.",
					},
					{ index: 2, status: "complete", variant: variant(2) },
				],
				recommendedVariantIndex: null,
				recommendedVariant: null,
			};
		});

		const { response } = await runRoute();

		expect(mocks.writeDebugJson).toHaveBeenCalledWith(
			debugSession,
			"generation-variant-errors.json",
			[
				{
					variant: 2,
					modelId: expect.any(String),
					message: privateDetail,
				},
			],
		);
		expect(response.text()).not.toContain(privateDetail);
		expect(response.ndjson().at(-1)).toEqual({
			type: "error",
			error: "Analysis could not complete all three variants.",
		});
	});

	it("does not retain private variant causes in production diagnostics", async () => {
		vi.stubEnv("NODE_ENV", "production");
		const privateDetail = "private production provider detail";
		mocks.processAnalysis.mockImplementation(async (_input, context) => {
			await context.diagnostics.record({
				severity: "warn",
				stage: "generation",
				code: "PROVIDER_FAILED",
				variantIndex: 0,
				error: new Error(privateDetail),
			});
			expect(context.diagnostics.list()).toEqual([]);
			return {
				outcomes: [
					{
						index: 0,
						status: "failed",
						safeMessage: "Variant generation failed.",
					},
					{ index: 1, status: "complete", variant: variant(1) },
					{ index: 2, status: "complete", variant: variant(2) },
				],
				recommendedVariantIndex: null,
				recommendedVariant: null,
			};
		});

		const { response } = await runRoute();
		const errorWrite = mocks.writeDebugJson.mock.calls.find(
			([, filename]) => filename === "generation-variant-errors.json",
		);

		expect(errorWrite[2]).toEqual([
			expect.objectContaining({ message: "Variant generation failed." }),
		]);
		expect(JSON.stringify(mocks.writeDebugJson.mock.calls)).not.toContain(
			privateDetail,
		);
		expect(response.text()).not.toContain(privateDetail);
	});

	it("keeps the primary incomplete result when variant debug writing fails", async () => {
		mocks.processAnalysis.mockResolvedValue({
			outcomes: [
				{
					index: 0,
					status: "failed",
					safeMessage: "Variant generation failed.",
				},
				{ index: 1, status: "complete", variant: variant(1) },
				{ index: 2, status: "complete", variant: variant(2) },
			],
			recommendedVariantIndex: null,
			recommendedVariant: null,
		});
		mocks.writeDebugJson.mockImplementation(async (_session, filename) => {
			if (filename === "generation-variant-errors.json") {
				throw new Error("debug disk failed");
			}
		});

		const { response } = await runRoute();

		expect(response.ndjson().at(-1)).toEqual({
			type: "error",
			error: "Analysis could not complete all three variants.",
		});
		expect(response.text()).not.toContain("debug disk failed");
	});

	it("preserves request debug files and completion identity", async () => {
		const { response } = await runRoute();
		expect(mocks.writeDebugImage).toHaveBeenCalledWith(
			debugSession,
			"image-data",
			"image/png",
		);
		expect(mocks.writeDebugJson).toHaveBeenCalledWith(
			debugSession,
			"request-meta.json",
			expect.objectContaining({ base64Length: 10 }),
		);
		expect(mocks.writeDebugJson).toHaveBeenCalledWith(
			debugSession,
			"generation-variants-summary.json",
			expect.arrayContaining([
				expect.objectContaining({ variant: 1, selected: true }),
			]),
		);
		expect(response.ndjson().at(-1).debug).toEqual({
			debugId: "debug-id",
			debugPath: "debug/analysis/debug-id",
		});
	});
});

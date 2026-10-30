import { afterEach, describe, expect, it, vi } from "vitest";
import { processAnalysis } from "../analysis.js";
import { processCategorization } from "../categorization.js";
import { processImprovement } from "../improvement.js";
import { processCustomSwatchAnalysis } from "../customSwatch.js";
import {
	createInMemoryArtifactStore,
	createNoopDiagnostics,
} from "../ports.js";
import {
	PROVIDER_FAILURE_CODES,
	ProviderRequestError,
} from "../../services/openRouter.js";
import { GenerationOutputError } from "../../services/screenshotGenerator.js";
import { DegradableRenderError } from "../../services/visualVerifier.js";
import {
	ProcessorBudgetExceededError,
	ProcessorCancelledError,
	ProcessorDeadlineExceededError,
	ProcessorFenceLostError,
	ProcessorLeaseLostError,
	ProcessorShutdownError,
} from "../../shared/errors.js";
import { resolveModelProfile } from "../../shared/modelProfiles.js";
import { createProviderLedger } from "../../shared/providerLedger.js";
import {
	createContextFixture,
	createManualClock,
} from "../../shared/__tests__/testUtils.js";

function contextFor(jobKind, { artifactStore, ...overrides } = {}) {
	const modelProfile = resolveModelProfile(jobKind, "default");
	return createContextFixture({
		modelProfile,
		providerLedger: createProviderLedger({
			attemptId: "attempt-1",
			...modelProfile.attemptLedgerCeilings,
		}),
		artifactStore: artifactStore || createInMemoryArtifactStore(),
		diagnostics: createNoopDiagnostics(),
		...overrides,
	});
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function candidate(index) {
	return {
		variantIndex: index,
		modelId: `server-profile-model-${index}`,
		html: `<main>${index}</main>`,
		issues: [],
		generation: { toolEvents: [] },
		renderedScreenshot: null,
		visualEvaluation: null,
	};
}

function publicCandidate(value) {
	return {
		id: `variant-${value.variantIndex + 1}`,
		index: value.variantIndex + 1,
		modelId: value.modelId,
		html: value.html,
		issues: value.issues,
		score: value.visualEvaluation?.score ?? 0.75,
		visualEvaluation: value.visualEvaluation,
		renderedScreenshot: value.renderedScreenshot
			? {
					base64: value.renderedScreenshot.base64,
					mediaType: value.renderedScreenshot.mediaType,
					relativePath: null,
				}
			: null,
		frameFit: value.renderedScreenshot?.fitDiagnostics || null,
		frameFitCorrected: false,
	};
}

function analysisDependencies(overrides = {}) {
	let requestSequence = 0;
	const nextProviderRequestId = vi.fn(
		() => `attempt-1:test:request:${(requestSequence += 1)}`,
	);
	return {
		apiKey: "server-secret",
		createProviderRequestIdFactory: vi.fn(() => nextProviderRequestId),
		generateCandidate: vi.fn(async ({ variantIndex }) => candidate(variantIndex)),
		renderAndEvaluateCandidate: vi.fn(async ({ candidate: value }) => ({
			...value,
			renderedScreenshot: {
				base64: `image-${value.variantIndex}`,
				mediaType: "image/png",
				fitDiagnostics: { fitsFrame: true },
			},
		})),
		correctFrameFitIfNeeded: vi.fn(async ({ candidate: value }) => value),
		evaluateRenderedCandidate: vi.fn(async ({ candidate: value }) => ({
			...value,
			visualEvaluation: {
				score: 90 - value.variantIndex,
				pass: true,
			},
		})),
		publicVariant: publicCandidate,
		scoreVariant: (value) => value.visualEvaluation.score,
		...overrides,
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const CONTROL_FLOW_ERRORS = [
	ProcessorCancelledError,
	ProcessorDeadlineExceededError,
	ProcessorBudgetExceededError,
	ProcessorLeaseLostError,
	ProcessorFenceLostError,
	ProcessorShutdownError,
];

describe("processAnalysis", () => {
	it("keeps canonical indexes sorted, causal events, stable ties, and one shared request-id owner", async () => {
		const events = [];
		const reports = [];
		const context = contextFor("analysis", {
			emitProcessorEvent: (event) => events.push(event),
			reportProgress: (...report) => reports.push(report),
		});
		const gates = [deferred(), deferred(), deferred()];
		const dependencies = analysisDependencies({
			generateCandidate: vi.fn(async ({ variantIndex }) => {
				await gates[variantIndex].promise;
				return candidate(variantIndex);
			}),
			evaluateRenderedCandidate: vi.fn(async ({ candidate: value }) => ({
				...value,
				visualEvaluation: { score: 91, pass: true },
			})),
			scoreVariant: () => 91,
		});
		const pending = processAnalysis(
			{ base64: "source-image" },
			context,
			dependencies,
		);
		await vi.waitFor(() => {
			expect(dependencies.generateCandidate).toHaveBeenCalledTimes(3);
		});
		gates[2].resolve();
		await Promise.resolve();
		gates[1].resolve();
		await Promise.resolve();
		gates[0].resolve();
		const result = await pending;

		expect(result.outcomes.map(({ index, status }) => ({ index, status }))).toEqual([
			{ index: 0, status: "complete" },
			{ index: 1, status: "complete" },
			{ index: 2, status: "complete" },
		]);
		expect(result.recommendedVariantIndex).toBe(0);
		expect(events.at(-1)).toMatchObject({
			type: "completion",
			recommendedVariantIndex: 0,
		});
		for (const index of [0, 1, 2]) {
			expect(
				events
					.filter((event) => event.variantIndex === index)
					.map((event) => event.type),
			).toEqual(["generation", "evaluation"]);
		}
		expect(reports.at(-1)[1]).toBe(100);
		expect(
			dependencies.createProviderRequestIdFactory,
		).toHaveBeenCalledTimes(1);
		expect(
			dependencies.evaluateRenderedCandidate.mock.calls.every(
				([call]) => call.strictProviderErrors === true,
			),
		).toBe(true);
		const requestFactories = [
			...dependencies.generateCandidate.mock.calls,
			...dependencies.renderAndEvaluateCandidate.mock.calls,
			...dependencies.correctFrameFitIfNeeded.mock.calls,
			...dependencies.evaluateRenderedCandidate.mock.calls,
		].map(([call]) => call.nextProviderRequestId);
		expect(new Set(requestFactories)).toHaveLength(1);
		expect(context.artifactStore.list().map(({ logicalKey }) => logicalKey)).toEqual([
			"analysis-manifest",
			"analysis-summary",
			"variant-0-evaluation",
			"variant-0-html",
			"variant-0-screenshot",
			"variant-1-evaluation",
			"variant-1-html",
			"variant-1-screenshot",
			"variant-2-evaluation",
			"variant-2-html",
			"variant-2-screenshot",
		]);
		const manifest = context.artifactStore.get("analysis-manifest").value;
		const expectedVariantBindings = [0, 1, 2].map((index) => ({
			index,
			status: "complete",
			artifactReferences: {
				html: `variant-${index}-html`,
				screenshot: `variant-${index}-screenshot`,
				evaluation: `variant-${index}-evaluation`,
			},
		}));
		expect(manifest).toEqual({
			schemaVersion: 1,
			status: "complete",
			variants: expectedVariantBindings,
			recommendedVariantIndex: 0,
			artifactReferences: [
				"analysis-summary",
				"variant-0-evaluation",
				"variant-0-html",
				"variant-0-screenshot",
				"variant-1-evaluation",
				"variant-1-html",
				"variant-1-screenshot",
				"variant-2-evaluation",
				"variant-2-html",
				"variant-2-screenshot",
			],
		});
		expect(
			context.artifactStore.get("analysis-summary").value.variants,
		).toEqual(expectedVariantBindings);
		const serializedManifest = JSON.stringify(manifest);
		expect(Buffer.byteLength(serializedManifest, "utf8")).toBeLessThanOrEqual(
			64 * 1024,
		);
		expect(serializedManifest).not.toMatch(
			/<main>|image-|base64|server-profile-model|provider/i,
		);
		expect(context.checkpointStore.createCompleted).not.toHaveBeenCalled();
	});

	it.each([1, 2, 3])(
		"returns three sorted outcomes and no completion for %s ordinary failure(s)",
		async (failureCount) => {
			const events = [];
			const context = contextFor("analysis", {
				emitProcessorEvent: (event) => events.push(event),
			});
			const dependencies = analysisDependencies({
				generateCandidate: vi.fn(async ({ variantIndex }) => {
					if (variantIndex < failureCount) {
						throw new ProviderRequestError(PROVIDER_FAILURE_CODES.TRANSPORT);
					}
					return candidate(variantIndex);
				}),
			});
			const result = await processAnalysis(
				{ base64: "source-image" },
				context,
				dependencies,
			);

			expect(result.outcomes).toHaveLength(3);
			expect(result.outcomes.map(({ index }) => index)).toEqual([0, 1, 2]);
			expect(
				result.outcomes.filter(({ status }) => status === "failed"),
			).toHaveLength(failureCount);
			expect(result.recommendedVariantIndex).toBeNull();
			expect(events.some(({ type }) => type === "completion")).toBe(false);
			expect(context.artifactStore.get("analysis-manifest")).toBeUndefined();
			expect(context.artifactStore.get("analysis-summary")).toBeUndefined();
			const attempt = context.artifactStore.get("analysis-attempt-summary");
			expect(attempt).toBeDefined();
			expect(JSON.stringify(attempt.value)).not.toMatch(
				/<main>|image-|base64|server-profile-model|provider secret/i,
			);
			expect(context.checkpointStore.createCompleted).not.toHaveBeenCalled();
		},
	);

	it.each([1, 2, 3])(
		"turns %s real malformed-generation service failures into indexed outcomes/events",
		async (failureCount) => {
			const context = contextFor("analysis");
			const modelIds = context.modelProfile.variants.map(
				({ provider }) => provider.modelId,
			);
			const failingModels = new Set(modelIds.slice(0, failureCount));
			vi.stubGlobal(
				"fetch",
				vi.fn().mockImplementation((_url, init) => {
					const { model } = JSON.parse(init.body);
					const content = failingModels.has(model)
						? "<!doctype html><html><head></head><body></body></html>"
						: `<main>valid ${model}</main>`;
					return Promise.resolve({
						ok: true,
						status: 200,
						json: vi.fn().mockResolvedValue({
							choices: [
								{ finish_reason: "stop", message: { content } },
							],
						}),
					});
				}),
			);
			const events = [];
			const eventContext = contextFor("analysis", {
				emitProcessorEvent: (event) => events.push(event),
			});
			const dependencies = analysisDependencies();
			delete dependencies.generateCandidate;

			const result = await processAnalysis(
				{ base64: "source-image" },
				eventContext,
				dependencies,
			);

			const failures = result.outcomes.filter(
				({ status }) => status === "failed",
			);
			expect(failures.map(({ index }) => index)).toEqual(
				Array.from({ length: failureCount }, (_, index) => index),
			);
			expect(failures).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						stage: "generation",
						code: "GENERATION_OUTPUT_INVALID",
						retryable: false,
					}),
				]),
			);
			expect(
				events.filter(({ type }) => type === "failure").map(({ variantIndex }) => variantIndex),
			).toEqual(Array.from({ length: failureCount }, (_, index) => index));
		},
	);

	it("passes indexed typed failures through diagnostics without retaining them in canonical results", async () => {
		const privateProviderDetail = "private malformed provider payload";
		const privateRenderDetail = "private browser crash detail";
		const generationError = new GenerationOutputError({
			cause: new Error(privateProviderDetail),
		});
		const renderError = new DegradableRenderError({
			cause: new Error(privateRenderDetail),
		});
		const diagnostics = { record: vi.fn() };
		const context = contextFor("analysis", { diagnostics });
		const dependencies = analysisDependencies({
			generateCandidate: vi.fn(async ({ variantIndex }) => {
				if (variantIndex === 0) throw generationError;
				if (variantIndex === 1) throw renderError;
				return candidate(variantIndex);
			}),
		});

		const result = await processAnalysis(
			{ base64: "source-image" },
			context,
			dependencies,
		);

		expect(diagnostics.record).toHaveBeenCalledWith(
			expect.objectContaining({
				stage: "generation",
				code: "PROVIDER_FAILED",
				variantIndex: 0,
				error: generationError,
			}),
		);
		expect(diagnostics.record).toHaveBeenCalledWith(
			expect.objectContaining({
				stage: "generation",
				code: "RENDER_FAILED",
				variantIndex: 1,
				error: renderError,
			}),
		);
		const publicAndCanonical = JSON.stringify({
			result,
			artifacts: context.artifactStore.list(),
		});
		expect(publicAndCanonical).not.toContain(privateProviderDetail);
		expect(publicAndCanonical).not.toContain(privateRenderDetail);
	});

	it.each([
		["transport", "PROVIDER_TRANSPORT_ERROR", true],
		["timeout", "PROVIDER_TIMEOUT", true],
		["retryable-http", "PROVIDER_HTTP_RETRYABLE", true],
	])(
		"preserves strict service-integrated %s evaluation classification",
		async (failureKind, expectedCode, expectedRetryable) => {
			if (failureKind === "timeout") {
				const timeoutController = new AbortController();
				timeoutController.abort(new Error("private timeout detail"));
				vi.spyOn(AbortSignal, "timeout").mockReturnValue(
					timeoutController.signal,
				);
			}
			vi.stubGlobal(
				"fetch",
				vi.fn().mockImplementation(() => {
					if (failureKind === "retryable-http") {
						return Promise.resolve({
							ok: false,
							status: 503,
							json: vi.fn().mockResolvedValue({ error: "private payload" }),
						});
					}
					return Promise.reject(new Error("private transport detail"));
				}),
			);
			const events = [];
			const context = contextFor("analysis", {
				emitProcessorEvent: (event) => events.push(event),
			});
			const dependencies = analysisDependencies();
			delete dependencies.evaluateRenderedCandidate;

			const result = await processAnalysis(
				{ base64: "source-image" },
				context,
				dependencies,
			);

			expect(result.outcomes).toHaveLength(3);
			for (const outcome of result.outcomes) {
				expect(outcome).toMatchObject({
					status: "failed",
					stage: "evaluation",
					code: expectedCode,
					retryable: expectedRetryable,
				});
			}
			expect(events.filter(({ type }) => type === "failure")).toHaveLength(3);
			expect(events.filter(({ type }) => type === "failure")).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						code: expectedCode,
						retryable: expectedRetryable,
					}),
				]),
			);
			expect(context.artifactStore.get("analysis-manifest")).toBeUndefined();
		},
	);

	it("persists the manifest before awaiting terminal event/progress delivery", async () => {
		const persisted = [];
		const backingStore = createInMemoryArtifactStore();
		const artifactStore = {
			async create(artifact, activity) {
				const created = await backingStore.create(artifact, activity);
				persisted.push(`artifact-${artifact.logicalKey}`);
				return created;
			},
			get: backingStore.get,
			list: backingStore.list,
		};
		const context = contextFor("analysis", {
			artifactStore,
			emitProcessorEvent: async (event) => {
				await new Promise((resolve) => setTimeout(resolve, 2));
				persisted.push(`event-${event.sequence}`);
			},
			reportProgress: async (_stage, percent) => {
				await new Promise((resolve) => setTimeout(resolve, 2));
				persisted.push(`progress-${percent}`);
			},
		});

		await processAnalysis(
			{ base64: "source-image" },
			context,
			analysisDependencies(),
		);

		const artifactCreates = persisted.filter((entry) =>
			entry.startsWith("artifact-"),
		);
		expect(artifactCreates.at(-1)).toBe("artifact-analysis-manifest");
		expect(persisted.indexOf("artifact-analysis-manifest")).toBeLessThan(
			persisted.indexOf("event-7"),
		);
		expect(persisted.at(-2)).toBe("event-7");
		expect(persisted.at(-1)).toBe("progress-100");
	});

	it("retains the prior manifest when async completion persistence fails", async () => {
		const expected = new Error("completion event persistence failed");
		const context = contextFor("analysis", {
			emitProcessorEvent: async (event) => {
				if (event.type === "completion") throw expected;
			},
		});

		await expect(
			processAnalysis(
				{ base64: "source-image" },
				context,
				analysisDependencies(),
			),
		).rejects.toBe(expected);
		expect(context.artifactStore.get("analysis-summary")).toBeDefined();
		expect(context.artifactStore.get("analysis-manifest")).toBeDefined();
	});

	it("does not emit completion or progress 100 when manifest creation fails", async () => {
		const expected = new Error("manifest persistence failed");
		const backingStore = createInMemoryArtifactStore();
		const artifactStore = {
			async create(artifact, activity) {
				if (artifact.logicalKey === "analysis-manifest") throw expected;
				return backingStore.create(artifact, activity);
			},
			get: backingStore.get,
			list: backingStore.list,
		};
		const events = [];
		const reports = [];
		const context = contextFor("analysis", {
			artifactStore,
			emitProcessorEvent: (event) => events.push(event),
			reportProgress: (...report) => reports.push(report),
		});

		await expect(
			processAnalysis(
				{ base64: "source-image" },
				context,
				analysisDependencies(),
			),
		).rejects.toBe(expected);
		expect(backingStore.get("analysis-summary")).toBeDefined();
		expect(backingStore.get("analysis-manifest")).toBeUndefined();
		expect(events.some(({ type }) => type === "completion")).toBe(false);
		expect(reports.some(([, percent]) => percent === 100)).toBe(false);
	});

	it("aborts a never-settling event port with exact control-flow identity and no late unhandled rejection", async () => {
		const controller = new AbortController();
		const lateDelivery = deferred();
		const delivered = [];
		const unhandled = [];
		const onUnhandled = (reason) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			const context = contextFor("analysis", {
				controller,
				emitProcessorEvent: (event) => {
					delivered.push(event.type);
					return lateDelivery.promise;
				},
			});
			const pending = processAnalysis(
				{ base64: "source-image" },
				context,
				analysisDependencies(),
			);
			await vi.waitFor(() => expect(delivered).toHaveLength(1));
			const expected = new ProcessorLeaseLostError({ stage: "event-port" });
			controller.abort(expected);

			await expect(pending).rejects.toBe(expected);
			expect(delivered).not.toContain("completion");
			lateDelivery.reject(new Error("late event rejection"));
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});

	it("deadlines a never-settling progress port and blocks later completion without an unhandled rejection", async () => {
		const clock = createManualClock();
		const lateDelivery = deferred();
		const delivered = [];
		const reports = [];
		const unhandled = [];
		const onUnhandled = (reason) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			const context = contextFor("analysis", {
				clock,
				emitProcessorEvent: (event) => delivered.push(event.type),
				reportProgress: (_stage, percent) => {
					reports.push(percent);
					return lateDelivery.promise;
				},
			});
			const pending = processAnalysis(
				{ base64: "source-image" },
				context,
				analysisDependencies(),
			);
			await vi.waitFor(() => expect(reports).toHaveLength(1));
			clock.advanceBy(10_000);

			await expect(pending).rejects.toBeInstanceOf(
				ProcessorDeadlineExceededError,
			);
			expect(delivered).not.toContain("completion");
			expect(reports).not.toContain(100);
			lateDelivery.reject(new Error("late progress rejection"));
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});

	it("preserves async control-flow rejection identity and suppresses completion", async () => {
		const expected = new ProcessorLeaseLostError({ stage: "event-write" });
		const delivered = [];
		const context = contextFor("analysis", {
			emitProcessorEvent: async (event) => {
				delivered.push(event.type);
				if (event.type === "evaluation") throw expected;
			},
		});

		await expect(
			processAnalysis(
				{ base64: "source-image" },
				context,
				analysisDependencies(),
			),
		).rejects.toBe(expected);
		expect(delivered).not.toContain("completion");
	});

	it("emits generation before an ordinary evaluation failure", async () => {
		const events = [];
		const context = contextFor("analysis", {
			emitProcessorEvent: (event) => events.push(event),
		});
		const dependencies = analysisDependencies({
			evaluateRenderedCandidate: vi.fn(async ({ candidate: value }) => {
				if (value.variantIndex === 1) {
					throw new ProviderRequestError(PROVIDER_FAILURE_CODES.RESPONSE);
				}
				return {
					...value,
					visualEvaluation: { score: 90, pass: true },
				};
			}),
		});
		const result = await processAnalysis(
			{ base64: "source-image" },
			context,
			dependencies,
		);
		expect(result.outcomes[1]).toMatchObject({
			index: 1,
			status: "failed",
			stage: "evaluation",
		});
		expect(
			events
				.filter(({ variantIndex }) => variantIndex === 1)
				.map(({ type }) => type),
		).toEqual(["generation", "failure"]);
	});

	it.each(CONTROL_FLOW_ERRORS)(
		"observes paid siblings and rethrows %s globally",
		async (ErrorClass) => {
			const sibling = deferred();
			let siblingObserved = false;
			const control = new ErrorClass({ stage: "generation" });
			const context = contextFor("analysis");
			const dependencies = analysisDependencies({
				generateCandidate: vi.fn(async ({ variantIndex }) => {
					if (variantIndex === 0) throw control;
					if (variantIndex === 1) {
						await sibling.promise;
						siblingObserved = true;
					}
					return candidate(variantIndex);
				}),
			});
			const pending = processAnalysis(
				{ base64: "source-image" },
				context,
				dependencies,
			);
			await vi.waitFor(() => {
				expect(dependencies.generateCandidate).toHaveBeenCalledTimes(3);
			});
			let settled = false;
			pending.finally(() => {
				settled = true;
			}).catch(() => {});
			await Promise.resolve();
			expect(settled).toBe(false);
			sibling.resolve();
			await expect(pending).rejects.toBe(control);
			expect(siblingObserved).toBe(true);
		},
	);

	it("rejects duplicate canonical artifact writes instead of using diagnostics", async () => {
		const store = createInMemoryArtifactStore();
		const firstContext = contextFor("analysis", { artifactStore: store });
		await processAnalysis(
			{ base64: "source-image" },
			firstContext,
			analysisDependencies(),
		);
		const secondContext = contextFor("analysis", { artifactStore: store });
		await expect(
			processAnalysis(
				{ base64: "source-image" },
				secondContext,
				analysisDependencies(),
			),
		).rejects.toThrow("already exists");
		expect(store.get("analysis-summary")).toBeDefined();
	});
});

describe("other HTTP-independent processors", () => {
	it("preserves categorization schema and provider fallback result", async () => {
		const context = contextFor("categorization");
		const factory = vi.fn(() => vi.fn());
		const categorize = vi.fn(async (call) => {
			expect(call.context).toBe(context);
			expect(call.provider).toBe(context.modelProfile.provider);
			expect(call.signal).toBe(context.signal);
			return {
				html: "<main>safe</main>",
				elements: [{ id: "root", role: "surface" }],
				semanticDebug: { semanticFallback: true },
			};
		});
		const result = await processCategorization(
			{ html: "<main>unsafe</main>", base64: "image" },
			context,
			{
				apiKey: "server-secret",
				createProviderRequestIdFactory: factory,
				categorizeHtmlForPalette: categorize,
			},
		);
		expect(result).toEqual({
			html: "<main>safe</main>",
			elements: [{ id: "root", role: "surface" }],
		});
		expect(factory).toHaveBeenCalledTimes(1);
		expect(context.artifactStore.list().map(({ logicalKey }) => logicalKey)).toEqual([
			"categorization-result",
			"categorized-elements",
			"categorized-html",
		]);
	});

	it.each(CONTROL_FLOW_ERRORS)(
		"rethrows %s through the categorization fallback boundary",
		async (ErrorClass) => {
			const expected = new ErrorClass({ stage: "categorization" });
			await expect(
				processCategorization(
					{ html: "<main />", base64: "image" },
					contextFor("categorization"),
					{
						apiKey: "server-secret",
						categorizeHtmlForPalette: vi.fn().mockRejectedValue(expected),
					},
				),
			).rejects.toBe(expected);
		},
	);

	it("uses only the improvement profile and stores the compatible result schema", async () => {
		const context = contextFor("improvement");
		const render = vi.fn(async ({ candidate: value, evaluateVisual = true }) => ({
			...value,
			renderedScreenshot: {
				base64: evaluateVisual ? "source" : "improved",
				mediaType: "image/png",
				fitDiagnostics: { fitsFrame: true },
			},
			visualEvaluation:
				value.visualEvaluation || { score: 0.9, pass: true, provenance: "source" },
		}));
		const correct = vi.fn(async ({ candidate: value }) => ({
			...value,
			html: "<main>improved</main>",
			issues: [],
			visualCorrected: true,
		}));
		const result = await processImprovement(
			{ html: "<main>source</main>", base64: "image" },
			context,
			{
				apiKey: "server-secret",
				renderAndEvaluateCandidate: render,
				correctCandidateWithVisualFeedback: correct,
				publicVariant: publicCandidate,
			},
		);
		expect(result).toMatchObject({
			id: "variant-1",
			html: "<main>improved</main>",
			frameFit: { fitsFrame: true },
		});
		expect(render).toHaveBeenCalledTimes(2);
		expect(render.mock.calls[1][0].evaluateVisual).toBe(false);
		expect(result.visualEvaluation).toMatchObject({ provenance: "source" });
		expect(context.artifactStore.get("source-evaluation").value).toMatchObject({
			provenance: "source",
		});
		expect(context.artifactStore.get("improved-evaluation")).toBeUndefined();
		expect(correct.mock.calls[0][0].provider).toBe(
			context.modelProfile.provider,
		);
		expect(context.artifactStore.list().map(({ logicalKey }) => logicalKey)).toEqual([
			"improved-html",
			"improved-screenshot",
			"improvement-result",
			"source-evaluation",
			"source-html",
			"source-screenshot",
		]);
		expect(context.checkpointStore.createCompleted).not.toHaveBeenCalled();
		await expect(
			processImprovement(
				{ html: "<main />", base64: "image", modelId: "client/model" },
				context,
				{ apiKey: "server-secret" },
			),
		).rejects.toThrow("must not contain a model id");
	});

	it("owns custom-swatch prompting, repair, normalization, and result artifacts", async () => {
		const context = contextFor("custom-swatch");
		const request = vi.fn(async (call) => {
			expect(call.provider).toBe(context.modelProfile.provider);
			expect(JSON.stringify(call.messages)).toContain("Poll options");
			return { text: "not-json", data: {} };
		});
		const parse = vi.fn(async (call) => {
			expect(call.text).toBe("not-json");
			return {
				parsed: {
					intent: "choice",
					applicationMode: "invalid-mode",
					confidence: 4,
					rationale: "r".repeat(300),
				},
			};
		});
		const result = await processCustomSwatchAnalysis(
			{
				base64: "image",
				swatch: { label: "Choice" },
				elements: [{ id: "poll" }],
				palette: { primary: "#000000" },
			},
			context,
			{
				apiKey: "server-secret",
				callOpenRouterForProcessor: request,
				parseOrRepairForProcessor: parse,
			},
		);
		expect(result).toEqual({
			intent: "choice",
			applicationMode: "softTintWithBorder",
			confidence: 1,
			rationale: "r".repeat(240),
		});
		expect(context.artifactStore.get("custom-swatch-result").value).toEqual(
			result,
		);
		expect(context.checkpointStore.createCompleted).not.toHaveBeenCalled();
	});
});

describe("processor module boundaries", () => {
	it("does not accept HTTP objects or import route/stream/debug transports", async () => {
		const modules = await Promise.all([
			import("../analysis.js"),
			import("../categorization.js"),
			import("../improvement.js"),
			import("../customSwatch.js"),
		]);
		expect(modules.map((module) => Object.keys(module))).toEqual([
			["processAnalysis"],
			["processCategorization"],
			["processImprovement"],
			["processCustomSwatchAnalysis"],
		]);
		await expect(
			processCustomSwatchAnalysis(
				{ base64: "image" },
				{ req: {}, res: {} },
				{ apiKey: "server-secret" },
			),
		).rejects.toThrow("immutable processor context");
	});
});

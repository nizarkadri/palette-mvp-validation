import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveModelProfile } from "../../shared/modelProfiles.js";
import { createProviderLedger } from "../../shared/providerLedger.js";
import {
	ProcessorCancelledError,
	ProcessorDeadlineExceededError,
} from "../../shared/errors.js";
import { createContextFixture, createManualClock } from "../../shared/__tests__/testUtils.js";
import {
	ProviderRequestError,
	callOpenRouterForProcessor,
	createProviderRequestIdFactory,
	parseOrRepairForProcessor,
} from "../openRouter.js";

function successPayload(usage) {
	return {
		choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
		...(usage ? { usage } : {}),
	};
}

function response(payload = successPayload()) {
	return {
		ok: true,
		status: 200,
		json: vi.fn().mockResolvedValue(payload),
	};
}

function processorFixture({
	clock = createManualClock(),
	controller,
	modelProfile = resolveModelProfile("improvement", "default"),
} = {}) {
	const providerLedger = createProviderLedger({
		attemptId: "attempt-1",
		...modelProfile.attemptLedgerCeilings,
	});
	const context = createContextFixture({
		clock,
		...(controller
			? { controller, signal: controller.signal }
			: {}),
		modelProfile,
		modelProfileRevision: modelProfile.revision,
		providerLedger,
		applicationDeadlineAt: clock.now() + 500,
		absoluteJobDeadlineAt: clock.now() + 800,
	});
	return {
		context,
		provider: modelProfile.provider,
		providerLedger,
		nextProviderRequestId: createProviderRequestIdFactory({
			attemptId: context.identity.attemptId,
		}),
	};
}

function processorCall(fixture, overrides = {}) {
	return callOpenRouterForProcessor({
		apiKey: "key",
		...fixture,
		kind: "generation",
		stage: "generation",
		messages: [{ role: "user", content: "hello" }],
		maxTokens: 999_999,
		...overrides,
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("processor-aware OpenRouter boundary", () => {
	it("uses only the pinned profile model and ceilings and propagates capped execution controls", async () => {
		const fixture = processorFixture();
		const timeoutController = new AbortController();
		const timeoutSpy = vi
			.spyOn(AbortSignal, "timeout")
			.mockReturnValue(timeoutController.signal);
		const fetchMock = vi.fn().mockResolvedValue(
			response(
				successPayload({
					prompt_tokens: 12,
					completion_tokens: 8,
					cost_micros: 300,
				}),
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await processorCall(fixture, {
			// Raw caller model-like fields are not part of the processor API and
			// cannot override the frozen provider descriptor.
			modelId: "attacker/raw-model",
			timeoutMs: 999_999,
		});

		const [, init] = fetchMock.mock.calls[0];
		const body = JSON.parse(init.body);
		expect(body.model).toBe(fixture.provider.modelId);
		expect(body.max_tokens).toBe(fixture.provider.requestCeilings.maxOutputTokens);
		expect(timeoutSpy).toHaveBeenCalledWith(500);
		expect(init.signal).toBeInstanceOf(AbortSignal);
		expect(fixture.providerLedger.snapshot().entries[0]).toMatchObject({
			kind: "generation",
			state: "reconciled",
			trustedUsage: { inputTokens: 12, outputTokens: 8, costMicros: 300 },
		});
	});

	it("retains worst-case exposure when provider usage is missing or incomplete", async () => {
		const fixture = processorFixture();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));

		await processorCall(fixture);

		const snapshot = fixture.providerLedger.snapshot();
		expect(snapshot.entries[0].state).toBe("retained");
		expect(snapshot.totals).toEqual({
			calls: 1,
			...fixture.provider.worstCaseReservation,
		});
	});

	it("creates distinct reservations for every supported processor request kind", async () => {
		const fixture = processorFixture();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
		const requestKinds = [
			"generation",
			"tool-turn",
			"regeneration",
			"evaluation",
			"correction",
			"custom-swatch",
			"transport-retry",
		];

		for (const kind of requestKinds) {
			await processorCall(fixture, { kind, stage: kind });
		}
		await parseOrRepairForProcessor({
			apiKey: "key",
			...fixture,
			text: "not-json",
			shapeInstructions: "return an object",
		});

		const entries = fixture.providerLedger.snapshot().entries;
		expect(new Set(entries.map((entry) => entry.requestId)).size).toBe(8);
		expect(entries.map((entry) => entry.kind)).toEqual([
			...requestKinds,
			"json-repair",
		]);
	});

	it("preserves processor control-flow identity through fetch cancellation", async () => {
		const controller = new AbortController();
		const fixture = processorFixture({ controller });
		vi.stubGlobal(
			"fetch",
			vi.fn((_url, init) =>
				new Promise((_, reject) => {
					init.signal.addEventListener("abort", () => reject(init.signal.reason), {
						once: true,
					});
				}),
			),
		);
		const reason = new ProcessorCancelledError({ stage: "generation" });

		const pending = processorCall(fixture);
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(fixture.providerLedger.snapshot().entries[0].state).toBe("retained");
	});

	it("rejects queued work with its original deadline control-flow error", async () => {
		const first = processorFixture();
		const second = processorFixture();
		const thirdController = new AbortController();
		const third = processorFixture({ controller: thirdController });
		const releases = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(() => new Promise((resolve) => releases.push(() => resolve(response())))),
		);
		const firstPending = processorCall(first);
		const secondPending = processorCall(second);
		const thirdPending = processorCall(third);
		await vi.waitFor(() => expect(releases).toHaveLength(2));
		const reason = new ProcessorDeadlineExceededError({ stage: "queued" });
		thirdController.abort(reason);

		await expect(thirdPending).rejects.toBe(reason);
		for (const release of releases.splice(0)) release();
		await Promise.all([firstPending, secondPending]);
	});

	it("wraps sealed transport rejections into safe provider errors and retains worst case", async () => {
		const fixture = processorFixture();
		const raw = Object.freeze(new Error("private transport detail"));
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(raw));

		let caught;
		try {
			await processorCall(fixture);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(ProviderRequestError);
		expect(caught.code).toBe("PROVIDER_TRANSPORT_ERROR");
		expect(caught.message).not.toContain("private transport detail");
		expect(caught.cause.cause).toBe(raw);
		expect(fixture.providerLedger.snapshot().entries[0].state).toBe("retained");
	});

	it("rejects tools on an unsupported canonical provider before ids, reservations, or fetch", async () => {
		const modelProfile = resolveModelProfile("improvement", "gemini-image");
		const fixture = processorFixture({ modelProfile });
		const nextProviderRequestId = vi.fn();
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			processorCall(
				{ ...fixture, nextProviderRequestId },
				{ tools: [{ type: "function" }], toolChoice: "auto" },
			),
		).rejects.toThrow("does not support tool use");
		expect(nextProviderRequestId).not.toHaveBeenCalled();
		expect(fixture.providerLedger.snapshot().entries).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		[408, "PROVIDER_HTTP_RETRYABLE", true],
		[429, "PROVIDER_HTTP_RETRYABLE", true],
		[500, "PROVIDER_HTTP_RETRYABLE", true],
		[503, "PROVIDER_HTTP_RETRYABLE", true],
		[400, "PROVIDER_HTTP_ERROR", false],
		[401, "PROVIDER_HTTP_ERROR", false],
		[404, "PROVIDER_HTTP_ERROR", false],
	])("classifies HTTP %i with stable safe metadata", async (status, code, retryable) => {
		const fixture = processorFixture();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
			ok: false,
			status,
			json: vi.fn().mockResolvedValue({ error: { message: "secret payload" } }),
		}));

		let caught;
		try {
			await processorCall(fixture);
		} catch (error) {
			caught = error;
		}
		expect(caught).toMatchObject({ code, retryable, httpStatus: status });
		expect(caught.message).not.toContain("secret payload");
		expect(caught.cause.message).not.toContain("secret payload");
	});

	it("turns a timeout capped by the effective deadline into deadline control flow", async () => {
		const clock = createManualClock(1_000);
		const fixture = processorFixture({ clock });
		const timeoutController = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal);
		vi.stubGlobal(
			"fetch",
			vi.fn((_url, init) =>
				new Promise((_, reject) => {
					init.signal.addEventListener("abort", () => reject(init.signal.reason), {
						once: true,
					});
				}),
			),
		);

		const pending = processorCall(fixture);
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
		clock.advanceBy(500);
		timeoutController.abort(new Error("provider timer"));

		await expect(pending).rejects.toBeInstanceOf(ProcessorDeadlineExceededError);
		expect(fixture.providerLedger.snapshot().entries[0].state).toBe("retained");
	});

	it("does not swallow body-read cancellation, timeout, or malformed success JSON", async () => {
		const controller = new AbortController();
		const cancelledFixture = processorFixture({ controller });
		let rejectBody;
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: vi.fn(() => new Promise((_, reject) => {
				rejectBody = reject;
			})),
		}));
		const reason = new ProcessorCancelledError({ stage: "body" });
		const cancelled = processorCall(cancelledFixture);
		await vi.waitFor(() => expect(rejectBody).toBeTypeOf("function"));
		controller.abort(reason);
		rejectBody(reason);
		await expect(cancelled).rejects.toBe(reason);

		const timeoutController = new AbortController();
		const timeoutSpy = vi
			.spyOn(AbortSignal, "timeout")
			.mockReturnValue(timeoutController.signal);
		const timeoutFixture = processorFixture();
		let rejectTimedOutBody;
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: vi.fn(() => new Promise((_, reject) => {
				rejectTimedOutBody = reject;
			})),
		}));
		const timedOut = processorCall(timeoutFixture);
		await vi.waitFor(() => expect(rejectTimedOutBody).toBeTypeOf("function"));
		timeoutController.abort(new Error("provider body timeout"));
		rejectTimedOutBody(new Error("private body abort"));
		await expect(timedOut).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
		timeoutSpy.mockRestore();

		const malformedFixture = processorFixture();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: vi.fn().mockRejectedValue(new SyntaxError("private malformed body")),
		}));
		await expect(processorCall(malformedFixture)).rejects.toMatchObject({
			code: "PROVIDER_RESPONSE_ERROR",
			message: "The model provider returned an invalid response.",
		});
	});

	it("serializes stateful request values once and dispatches that exact snapshot", async () => {
		const fixture = processorFixture();
		let serializationCount = 0;
		const statefulContent = {
			toJSON() {
				serializationCount += 1;
				return serializationCount === 1 ? "first snapshot" : "changed snapshot";
			},
		};
		const fetchMock = vi.fn().mockResolvedValue(response());
		vi.stubGlobal("fetch", fetchMock);

		await processorCall(fixture, {
			messages: [{ role: "user", content: statefulContent }],
		});

		expect(serializationCount).toBe(1);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages).toEqual([
			{ role: "user", content: "first snapshot" },
		]);
	});

	it("does not re-read caller messages or tools while waiting for a provider permit", async () => {
		const blockers = [processorFixture(), processorFixture()];
		const queuedFixture = processorFixture();
		const pendingFetches = [];
		const fetchMock = vi.fn((_url, init) =>
			new Promise((resolve) => pendingFetches.push({ init, resolve })),
		);
		vi.stubGlobal("fetch", fetchMock);
		const blockerCalls = blockers.map((fixture) => processorCall(fixture));
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

		const messages = [{ role: "user", content: "queued snapshot" }];
		const tools = [{
			type: "function",
			function: { name: "original_tool", parameters: { type: "object" } },
		}];
		const nextProviderRequestId = vi.fn(
			createProviderRequestIdFactory({ attemptId: "attempt-1" }),
		);
		const queuedCall = processorCall(
			{ ...queuedFixture, nextProviderRequestId },
			{
				messages,
				tools,
				toolChoice: "auto",
				modelId: "caller-model-is-ignored",
			},
		);
		await vi.waitFor(() => expect(nextProviderRequestId).toHaveBeenCalledOnce());

		messages[0].content = "x".repeat(200_000);
		messages.push({ role: "user", content: "mutated" });
		tools[0].function.name = "mutated_tool";
		tools.push({ type: "function", function: { name: "extra_tool" } });
		pendingFetches[0].resolve(response());
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

		const queuedBody = JSON.parse(fetchMock.mock.calls[2][1].body);
		expect(queuedBody).toMatchObject({
			model: queuedFixture.provider.modelId,
			messages: [{ role: "user", content: "queued snapshot" }],
			tools: [{
				type: "function",
				function: { name: "original_tool", parameters: { type: "object" } },
			}],
			tool_choice: "auto",
		});

		for (const pending of pendingFetches.slice(1)) pending.resolve(response());
		await Promise.all([...blockerCalls, queuedCall]);
	});

	it.each([
		[{ role: "user", content: "x".repeat(130_000) }],
		[{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${"a".repeat(130_000)}` } }] }],
		[{ role: "user", content: `<html>${"z".repeat(130_000)}</html>` }],
	])("rejects conservatively oversized input before ids, reservations, and fetch", async (message) => {
		const fixture = processorFixture();
		const nextProviderRequestId = vi.fn();
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			processorCall(
				{ ...fixture, nextProviderRequestId },
				{ messages: [message] },
			),
		).rejects.toMatchObject({ code: "PROVIDER_INPUT_LIMIT_EXCEEDED" });
		expect(nextProviderRequestId).not.toHaveBeenCalled();
		expect(fixture.providerLedger.snapshot().entries).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects an oversized stateful snapshot before ids, reservations, or fetch", async () => {
		const fixture = processorFixture();
		const nextProviderRequestId = vi.fn();
		const fetchMock = vi.fn();
		let serializationCount = 0;
		const statefulContent = {
			toJSON() {
				serializationCount += 1;
				return serializationCount === 1 ? "x".repeat(130_000) : "small";
			},
		};
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			processorCall(
				{ ...fixture, nextProviderRequestId },
				{ messages: [{ role: "user", content: statefulContent }] },
			),
		).rejects.toMatchObject({ code: "PROVIDER_INPUT_LIMIT_EXCEEDED" });
		expect(serializationCount).toBe(1);
		expect(nextProviderRequestId).not.toHaveBeenCalled();
		expect(fixture.providerLedger.snapshot().entries).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects a deeply frozen fabricated provider descriptor", async () => {
		const fixture = processorFixture();
		const fabricated = Object.freeze({
			...fixture.provider,
			requestCeilings: Object.freeze({ ...fixture.provider.requestCeilings }),
			worstCaseReservation: Object.freeze({ ...fixture.provider.worstCaseReservation }),
		});
		await expect(
			processorCall(fixture, { provider: fabricated }),
		).rejects.toThrow("canonical server-owned provider");
	});

	it("classifies raw provider payload failures into stable safe errors", async () => {
		const fixture = processorFixture();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
			ok: false,
			status: 400,
			json: vi.fn().mockResolvedValue({ error: { message: "secret payload" } }),
		}));

		let caught;
		try {
			await processorCall(fixture);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(ProviderRequestError);
		expect(caught.code).toBe("PROVIDER_HTTP_ERROR");
		expect(caught.message).not.toContain("secret payload");
	});
});

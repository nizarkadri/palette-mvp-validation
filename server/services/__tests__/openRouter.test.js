import { afterEach, describe, expect, it, vi } from "vitest";
import { callOpenRouter, parseOrRepair } from "../openRouter.js";

const successPayload = {
	choices: [
		{
			finish_reason: "stop",
			message: { content: '{"ok":true}' },
		},
	],
};

function successfulResponse() {
	return {
		ok: true,
		status: 200,
		json: vi.fn().mockResolvedValue(successPayload),
	};
}

function rejectWhenAborted(signal) {
	return new Promise((_, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		signal.addEventListener("abort", () => reject(signal.reason), {
			once: true,
		});
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("callOpenRouter cancellation and deadlines", () => {
	it("uses the default timeout and preserves the provider request shape", async () => {
		const timeoutController = new AbortController();
		const timeoutSpy = vi
			.spyOn(AbortSignal, "timeout")
			.mockReturnValue(timeoutController.signal);
		const fetchMock = vi.fn().mockResolvedValue(successfulResponse());
		vi.stubGlobal("fetch", fetchMock);
		const messages = [{ role: "user", content: "hello" }];

		await callOpenRouter("key", "model", messages, 100, {
			temperature: 0.2,
			tools: [{ type: "function", function: { name: "write_html" } }],
			tool_choice: "auto",
		});

		expect(timeoutSpy).toHaveBeenCalledWith(120_000);
		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
		expect(init.signal).toBe(timeoutController.signal);
		expect(init.headers).toMatchObject({
			Authorization: "Bearer key",
			"Content-Type": "application/json",
		});
		expect(JSON.parse(init.body)).toEqual({
			model: "model",
			max_tokens: 100,
			temperature: 0.2,
			response_format: { type: "json_object" },
			tools: [{ type: "function", function: { name: "write_html" } }],
			tool_choice: "auto",
			messages,
		});
	});

	it("reports caller cancellation distinctly", async () => {
		const controller = new AbortController();
		vi.stubGlobal(
			"fetch",
			vi.fn((_url, init) => rejectWhenAborted(init.signal)),
		);

		const request = callOpenRouter("key", "model", [], 100, {
			signal: controller.signal,
			timeoutMs: 1_000,
		});
		controller.abort();

		await expect(request).rejects.toThrow("OpenRouter request was cancelled.");
	});

	it("bounds requests with the configured timeout without wall-clock timing", async () => {
		const timeoutController = new AbortController();
		const timeoutSpy = vi
			.spyOn(AbortSignal, "timeout")
			.mockReturnValue(timeoutController.signal);
		vi.stubGlobal(
			"fetch",
			vi.fn((_url, init) => rejectWhenAborted(init.signal)),
		);

		const request = callOpenRouter("key", "model", [], 100, {
			timeoutMs: 321,
		});
		timeoutController.abort(new Error("deadline"));

		await expect(request).rejects.toThrow(
			"OpenRouter request timed out after 321ms.",
		);
		expect(timeoutSpy).toHaveBeenCalledWith(321);
	});

	it("propagates caller cancellation and timeout through JSON repair", async () => {
		const timeoutController = new AbortController();
		const timeoutSpy = vi
			.spyOn(AbortSignal, "timeout")
			.mockReturnValue(timeoutController.signal);
		const caller = new AbortController();
		const fetchMock = vi.fn().mockResolvedValue(successfulResponse());
		vi.stubGlobal("fetch", fetchMock);

		const result = await parseOrRepair(
			"key",
			"model",
			"not-json",
			"return an object",
			{ signal: caller.signal, timeoutMs: 4_321 },
		);

		expect(result.repaired).toBe(true);
		expect(timeoutSpy).toHaveBeenCalledWith(4_321);
		expect(fetchMock.mock.calls[0][1].signal).not.toBe(caller.signal);
		expect(fetchMock.mock.calls[0][1].signal).not.toBe(
			timeoutController.signal,
		);
		expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
	});

	it("rejects invalid timeout configuration before fetching", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			callOpenRouter("key", "model", [], 100, { timeoutMs: 0 }),
		).rejects.toThrow("OpenRouter timeoutMs must be a positive number.");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

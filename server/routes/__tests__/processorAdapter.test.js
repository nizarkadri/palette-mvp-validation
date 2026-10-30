import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { processAnalysis } from "../../pipeline/analysis.js";
import { ProcessorCancelledError } from "../../shared/errors.js";
import { createLocalProcessorAdapter } from "../processorAdapter.js";

function transport({ aborted = false } = {}) {
	const req = new EventEmitter();
	req.aborted = aborted;
	req.complete = true;
	const res = new EventEmitter();
	res.finished = false;
	res.writableEnded = false;
	return { req, res };
}

describe("createLocalProcessorAdapter transport cancellation", () => {
	it("starts pre-aborted and prevents provider/render dispatch", async () => {
		const { req, res } = transport({ aborted: true });
		const adapter = createLocalProcessorAdapter(req, res);
		const context = adapter.createContext({ jobKind: "analysis" });
		const generateCandidate = vi.fn();
		const renderAndEvaluateCandidate = vi.fn();

		expect(context.signal.aborted).toBe(true);
		expect(context.signal.reason).toBeInstanceOf(ProcessorCancelledError);
		expect(context.signal.reason.stage).toBe("request-aborted");
		await expect(
			processAnalysis({ base64: "image-data" }, context, {
				apiKey: "key",
				generateCandidate,
				renderAndEvaluateCandidate,
			}),
		).rejects.toBe(context.signal.reason);
		expect(generateCandidate).not.toHaveBeenCalled();
		expect(renderAndEvaluateCandidate).not.toHaveBeenCalled();

		adapter.dispose();
	});

	it("aborts in-flight work when the response closes after request body completion", async () => {
		const { req, res } = transport();
		const adapter = createLocalProcessorAdapter(req, res);
		const context = adapter.createContext({ jobKind: "analysis" });
		const inFlight = new Promise((_, reject) => {
			context.signal.addEventListener(
				"abort",
				() => reject(context.signal.reason),
				{ once: true },
			);
		});

		res.emit("close");

		await expect(inFlight).rejects.toBeInstanceOf(ProcessorCancelledError);
		expect(context.signal.reason.stage).toBe("response-closed");
		adapter.dispose();
	});

	it("does not cancel for a normal response close after end", () => {
		const { req, res } = transport();
		const adapter = createLocalProcessorAdapter(req, res);

		res.writableEnded = true;
		res.finished = true;
		res.emit("close");

		expect(adapter.signal.aborted).toBe(false);
		adapter.dispose();
	});

	it("observes future request aborts and removes every req/res listener on dispose", () => {
		const { req, res } = transport();
		const adapter = createLocalProcessorAdapter(req, res);
		expect(req.listenerCount("aborted")).toBe(1);
		expect(res.listenerCount("close")).toBe(1);

		req.emit("aborted");
		expect(adapter.signal.reason).toBeInstanceOf(ProcessorCancelledError);
		adapter.dispose();

		expect(req.listenerCount("aborted")).toBe(0);
		expect(res.listenerCount("close")).toBe(0);
	});
});

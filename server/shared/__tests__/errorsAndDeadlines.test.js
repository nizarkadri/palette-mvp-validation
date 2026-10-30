import { describe, expect, it } from "vitest";
import {
	capTimeoutMs,
	effectiveDeadlineAt,
	remainingTimeMs,
	throwIfDeadlineExceeded,
} from "../deadlines.js";
import {
	CONTROL_FLOW_CODES,
	ProcessorBudgetExceededError,
	ProcessorCancelledError,
	ProcessorControlFlowError,
	ProcessorDeadlineExceededError,
	ProcessorFenceLostError,
	ProcessorLeaseLostError,
	ProcessorShutdownError,
	isProcessorControlFlowError,
	rethrowIfProcessorControlFlow,
	throwIfAborted,
} from "../errors.js";
import { createManualClock } from "./testUtils.js";

describe("processor control-flow errors", () => {
	it.each([
		[new ProcessorCancelledError(), CONTROL_FLOW_CODES.CANCELLED],
		[
			new ProcessorDeadlineExceededError(),
			CONTROL_FLOW_CODES.DEADLINE_EXCEEDED,
		],
		[new ProcessorBudgetExceededError(), CONTROL_FLOW_CODES.BUDGET_EXCEEDED],
		[new ProcessorLeaseLostError(), CONTROL_FLOW_CODES.LEASE_LOST],
		[new ProcessorFenceLostError(), CONTROL_FLOW_CODES.FENCE_LOST],
		[new ProcessorShutdownError(), CONTROL_FLOW_CODES.SHUTDOWN],
	])("provides stable safe taxonomy for %s", (error, code) => {
		expect(error).toBeInstanceOf(ProcessorControlFlowError);
		expect(error.code).toBe(code);
		expect(error.message).toBe(error.safeMessage);
		expect(error.message).not.toContain("provider");
		expect(isProcessorControlFlowError(error)).toBe(true);
	});

	it("keeps raw cancellation detail only as the cause", () => {
		const controller = new AbortController();
		const rawReason = new Error("private provider cancellation detail");
		controller.abort(rawReason);

		expect(() => throwIfAborted(controller.signal, "generation")).toThrow(
			ProcessorCancelledError,
		);
		try {
			throwIfAborted(controller.signal, "generation");
		} catch (error) {
			expect(error.message).not.toContain("private provider");
			expect(error.cause).toBe(rawReason);
			expect(error.stage).toBe("generation");
		}
	});

	it("preserves an existing control-flow abort reason by identity", () => {
		const controller = new AbortController();
		const reason = new ProcessorShutdownError({ stage: "render" });
		controller.abort(reason);

		expect(() => throwIfAborted(controller.signal)).toThrow(reason);
	});

	it("rethrows only recognized processor control-flow errors", () => {
		const controlFlow = new ProcessorLeaseLostError();
		expect(() => rethrowIfProcessorControlFlow(controlFlow)).toThrow(
			controlFlow,
		);
		expect(() =>
			rethrowIfProcessorControlFlow(new Error("ordinary")),
		).not.toThrow();
	});
});

describe("processor deadline helpers", () => {
	it("uses the earlier explicit application and absolute deadline", () => {
		expect(
			effectiveDeadlineAt({
				applicationDeadlineAt: 5_000,
				absoluteJobDeadlineAt: 4_000,
			}),
		).toBe(4_000);
	});

	it.each([
		[{ applicationDeadlineAt: undefined, absoluteJobDeadlineAt: 2_000 }],
		[{ applicationDeadlineAt: 2_000, absoluteJobDeadlineAt: Number.NaN }],
	])("rejects missing or invalid explicit deadlines", (deadlines) => {
		expect(() => effectiveDeadlineAt(deadlines)).toThrow(TypeError);
	});

	it("treats equality with the deadline as expired", () => {
		const clock = createManualClock(5_000);
		expect(() => throwIfDeadlineExceeded(5_000, clock, "provider")).toThrow(
			ProcessorDeadlineExceededError,
		);
	});

	it("caps operation timeout by positive remaining time", () => {
		const clock = createManualClock(1_000);
		expect(remainingTimeMs(1_250, clock)).toBe(250);
		expect(capTimeoutMs(500, 1_250, clock)).toBe(250);
		expect(capTimeoutMs(100, 1_250, clock)).toBe(100);
	});

	it("fails closed when a structurally valid clock returns a non-finite value", () => {
		const badClock = {
			now: () => Number.NaN,
			setTimeout: () => 1,
			clearTimeout: () => {},
		};
		expect(() => remainingTimeMs(2_000, badClock)).toThrow("clock.now()");
		expect(() => capTimeoutMs(100, 2_000, badClock)).toThrow("clock.now()");
	});

	it("never starts a timeout after the effective deadline", () => {
		const clock = createManualClock(1_000);
		expect(() => capTimeoutMs(100, 1_000, clock, "provider")).toThrow(
			ProcessorDeadlineExceededError,
		);
	});
});

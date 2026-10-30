import { describe, expect, it, vi } from "vitest";
import {
	assertProcessorActive,
	capProcessorTimeoutMs,
	processorRemainingTimeMs,
} from "../processorContext.js";
import {
	ProcessorCancelledError,
	ProcessorDeadlineExceededError,
} from "../errors.js";
import { resolveModelProfile } from "../modelProfiles.js";
import { createContextFixture, createManualClock } from "./testUtils.js";

describe("processor context", () => {
	it("freezes identity and derives the effective deadline", () => {
		const clock = createManualClock(1_000);
		const context = createContextFixture({
			clock,
			applicationDeadlineAt: 9_000,
			absoluteJobDeadlineAt: 7_000,
		});

		expect(context.effectiveDeadlineAt).toBe(7_000);
		expect(Object.isFrozen(context)).toBe(true);
		expect(Object.isFrozen(context.identity)).toBe(true);
		expect(() => {
			context.identity.jobId = "changed";
		}).toThrow();
	});

	it.each([
		["string", "7"],
		["negative", -1],
		["unsafe", Number.MAX_SAFE_INTEGER + 1],
	])("rejects a %s fence token", (_name, fenceToken) => {
		expect(() =>
			createContextFixture({
				identity: {
					jobId: "job-1",
					attemptId: "attempt-1",
					fenceToken,
				},
			}),
		).toThrow("non-negative safe integer");
	});

	it.each([
		["signal", { signal: null }],
		["provider ledger", { providerLedger: {} }],
		["logger", { logger: {} }],
		["progress reporter", { reportProgress: null }],
		["event emitter", { emitProcessorEvent: null }],
		["diagnostics", { diagnostics: {} }],
		["artifact store", { artifactStore: {} }],
		["checkpoint store", { checkpointStore: {} }],
	])("rejects a missing required %s port", (_name, override) => {
		expect(() => createContextFixture(override)).toThrow(TypeError);
	});

	it("rejects a provider ledger from a different worker attempt", () => {
		const wrongAttemptLedger = {
			attemptId: "attempt-other",
			reserve: vi.fn(),
			markDispatched: vi.fn(),
			releaseUndispatched: vi.fn(),
			settle: vi.fn(),
			snapshot: vi.fn(),
		};

		expect(() =>
			createContextFixture({ providerLedger: wrongAttemptLedger }),
		).toThrow("attemptId does not match");
	});

	it("requires a canonical deeply frozen model profile with matching revision", () => {
		const shallowProfile = Object.freeze({
			revision: "v1",
			pricing: { input: 1 },
		});
		expect(() =>
			createContextFixture({
				modelProfile: shallowProfile,
				modelProfileRevision: "v1",
			}),
		).toThrow("deeply frozen");

		const fabricatedProfile = Object.freeze({ revision: "v1" });
		expect(() =>
			createContextFixture({
				modelProfile: fabricatedProfile,
				modelProfileRevision: "v1",
			}),
		).toThrow("canonical server-owned");

		const canonicalProfile = resolveModelProfile("analysis", "default");
		expect(() =>
			createContextFixture({
				modelProfile: canonicalProfile,
				modelProfileRevision: "different-revision",
			}),
		).toThrow("does not match");
	});

	it.each([
		["Map", Object.freeze(new Map())],
		["Set", Object.freeze(new Set())],
		["Date", Object.freeze(new Date(0))],
		["function", Object.freeze(() => {})],
	])("rejects mutable or non-JSON-like %s model-profile values", (_name, value) => {
		const profile = Object.freeze({ revision: "v1", value });
		expect(() =>
			createContextFixture({
				modelProfile: profile,
				modelProfileRevision: "v1",
			}),
		).toThrow("JSON-like");
	});

	it("checks cancellation before an expired deadline", () => {
		const clock = createManualClock(1_000);
		const controller = new AbortController();
		const reason = new ProcessorCancelledError({ stage: "worker" });
		controller.abort(reason);
		const context = createContextFixture({
			clock,
			controller,
			signal: controller.signal,
			applicationDeadlineAt: 1_000,
			absoluteJobDeadlineAt: 1_000,
		});

		expect(() => assertProcessorActive(context, "generation")).toThrow(reason);
	});

	it("reports remaining time and caps provider timeouts", () => {
		const clock = createManualClock(1_000);
		const context = createContextFixture({
			clock,
			applicationDeadlineAt: 1_750,
			absoluteJobDeadlineAt: 2_000,
		});

		expect(processorRemainingTimeMs(context)).toBe(750);
		expect(capProcessorTimeoutMs(context, 1_000, "provider")).toBe(750);
		clock.advanceBy(750);
		expect(() => assertProcessorActive(context, "provider")).toThrow(
			ProcessorDeadlineExceededError,
		);
	});

	it("accepts the documented reportProgress signature as a plain function", () => {
		const reportProgress = vi.fn();
		const context = createContextFixture({ reportProgress });
		context.reportProgress("preparing", 5, "Preparing analysis.");
		expect(reportProgress).toHaveBeenCalledWith(
			"preparing",
			5,
			"Preparing analysis.",
		);
	});

	it("requires both explicit deadlines instead of inventing defaults", () => {
		expect(() =>
			createContextFixture({ applicationDeadlineAt: undefined }),
		).toThrow("applicationDeadlineAt");
		expect(() =>
			createContextFixture({ absoluteJobDeadlineAt: undefined }),
		).toThrow("absoluteJobDeadlineAt");
	});
});

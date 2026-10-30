import { describe, expect, it } from "vitest";
import { ProcessorBudgetExceededError } from "../errors.js";
import {
	ProviderLedgerInvariantError,
	createProviderLedger,
} from "../providerLedger.js";

function createLedger(overrides = {}) {
	return createProviderLedger({
		attemptId: "attempt-1",
		maxCalls: 3,
		maxInputTokens: 1_000,
		maxOutputTokens: 500,
		maxCostMicros: 10_000,
		...overrides,
	});
}

function reservation(requestId, overrides = {}) {
	return {
		requestId,
		kind: "generation",
		worstCase: {
			inputTokens: 200,
			outputTokens: 100,
			costMicros: 2_000,
			...overrides,
		},
	};
}

describe("per-attempt provider ledger", () => {
	it("is immutably bound to one worker attempt", () => {
		const ledger = createLedger();
		expect(ledger.attemptId).toBe("attempt-1");
		expect(ledger.snapshot().attemptId).toBe("attempt-1");
		expect(Object.isFrozen(ledger)).toBe(true);
		expect(() => createLedger({ attemptId: "" })).toThrow("attemptId");
	});

	it("atomically reserves one call and worst-case exposure", () => {
		const ledger = createLedger();
		const entry = ledger.reserve(reservation("request-1"));

		expect(entry).toMatchObject({
			requestId: "request-1",
			kind: "generation",
			state: "reserved",
			dispatched: false,
		});
		expect(ledger.snapshot().totals).toEqual({
			calls: 1,
			inputTokens: 200,
			outputTokens: 100,
			costMicros: 2_000,
		});
	});

	it("rejects budget overflow without partial mutation", () => {
		const ledger = createLedger({ maxCalls: 1 });
		ledger.reserve(reservation("request-1"));
		const before = ledger.snapshot();

		expect(() => ledger.reserve(reservation("request-2"))).toThrow(
			ProcessorBudgetExceededError,
		);
		expect(ledger.snapshot()).toEqual(before);
	});

	it("rejects duplicate reservation IDs", () => {
		const ledger = createLedger();
		ledger.reserve(reservation("request-1"));
		expect(() => ledger.reserve(reservation("request-1"))).toThrow(
			"Duplicate provider reservation",
		);
	});

	it("releases only work known not to have been dispatched", () => {
		const ledger = createLedger();
		ledger.reserve(reservation("not-dispatched"));
		expect(ledger.releaseUndispatched("not-dispatched").state).toBe("released");
		expect(ledger.snapshot().totals.calls).toBe(0);

		ledger.reserve(reservation("dispatched"));
		ledger.markDispatched("dispatched");
		expect(() => ledger.releaseUndispatched("dispatched")).toThrow(
			"cannot be released",
		);
	});

	it.each([
		undefined,
		{},
		{ inputTokens: 10, outputTokens: 5 },
	])("retains worst-case exposure when trusted usage is incomplete: %j", (trustedUsage) => {
		const ledger = createLedger();
		ledger.reserve(reservation("request-1"));
		ledger.markDispatched("request-1");

		const entry = ledger.settle("request-1", { trustedUsage });

		expect(entry.state).toBe("retained");
		expect(ledger.snapshot().totals).toEqual({
			calls: 1,
			inputTokens: 200,
			outputTokens: 100,
			costMicros: 2_000,
		});
	});

	it("reconciles only complete trusted usage and releases the delta", () => {
		const ledger = createLedger();
		ledger.reserve(reservation("request-1"));
		ledger.markDispatched("request-1");

		const entry = ledger.settle("request-1", {
			trustedUsage: {
				inputTokens: 120,
				outputTokens: 40,
				costMicros: 900,
			},
		});

		expect(entry.state).toBe("reconciled");
		expect(entry.trustedUsage).toEqual({
			inputTokens: 120,
			outputTokens: 40,
			costMicros: 900,
		});
		expect(ledger.snapshot().totals).toEqual({
			calls: 1,
			inputTokens: 120,
			outputTokens: 40,
			costMicros: 900,
		});
	});

	it("rejects impossible trusted usage without releasing exposure", () => {
		const ledger = createLedger();
		ledger.reserve(reservation("request-1"));
		ledger.markDispatched("request-1");

		expect(() =>
			ledger.settle("request-1", {
				trustedUsage: {
					inputTokens: 201,
					outputTokens: 20,
					costMicros: 1_000,
				},
			}),
		).toThrow(ProviderLedgerInvariantError);
		expect(ledger.snapshot().entries[0].state).toBe("retained");
		expect(ledger.snapshot().totals).toEqual({
			calls: 1,
			inputTokens: 200,
			outputTokens: 100,
			costMicros: 2_000,
		});
	});

	it("makes terminal settlement idempotent", () => {
		const ledger = createLedger();
		ledger.reserve(reservation("request-1"));
		ledger.markDispatched("request-1");
		const first = ledger.settle("request-1");
		const second = ledger.settle("request-1", {
			trustedUsage: { inputTokens: 1, outputTokens: 1, costMicros: 1 },
		});

		expect(first).toEqual(second);
		expect(second.state).toBe("retained");
	});

	it("accounts each tool, repair, evaluation, and retry as a separate request", () => {
		const ledger = createLedger({ maxCalls: 4 });
		for (const kind of ["tool", "repair", "evaluation", "transport-retry"]) {
			ledger.reserve({ ...reservation(kind), kind });
		}
		expect(ledger.snapshot().totals.calls).toBe(4);
		expect(ledger.snapshot().entries.map((entry) => entry.kind)).toEqual([
			"tool",
			"repair",
			"evaluation",
			"transport-retry",
		]);
	});
});

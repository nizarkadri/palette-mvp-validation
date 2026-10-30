import { describe, expect, it, vi } from "vitest";
import {
	ProcessorBudgetExceededError,
	ProcessorCancelledError,
} from "../errors.js";
import { executeProviderRequest } from "../providerExecution.js";
import { createProviderLedger } from "../providerLedger.js";
import { createSemaphore } from "../semaphore.js";
import { createContextFixture, createManualClock } from "./testUtils.js";

function reservation(requestId = "provider-1") {
	return {
		requestId,
		kind: "generation",
		worstCase: {
			inputTokens: 1_000,
			outputTokens: 500,
			costMicros: 20_000,
		},
	};
}

function ledgerWithLimits(overrides = {}) {
	return createProviderLedger({
		attemptId: "attempt-1",
		maxCalls: 3,
		maxInputTokens: 10_000,
		maxOutputTokens: 5_000,
		maxCostMicros: 200_000,
		...overrides,
	});
}

describe("provider request execution coordinator", () => {
	it("enforces acquire → reserve → dispatch → reconcile → release ordering", async () => {
		const order = [];
		const fakeLedger = {
			attemptId: "attempt-1",
			reserve: vi.fn(() => order.push("reserve")),
			markDispatched: vi.fn(() => order.push("mark-dispatched")),
			releaseUndispatched: vi.fn(() => order.push("release-undispatched")),
			settle: vi.fn(() => order.push("settle")),
			snapshot: vi.fn(() => ({})),
		};
		const fakeSemaphore = {
			acquire: vi.fn(async () => {
				order.push("acquire");
				return () => order.push("release-permit");
			}),
		};
		const context = createContextFixture({ providerLedger: fakeLedger });
		const dispatch = vi.fn(async () => {
			order.push("dispatch");
			return { id: "response" };
		});

		await executeProviderRequest({
			context,
			semaphore: fakeSemaphore,
			reservation: reservation(),
			configuredTimeoutMs: 1_000,
			dispatch,
			getTrustedUsage: () => ({
				inputTokens: 100,
				outputTokens: 50,
				costMicros: 1_000,
			}),
		});

		expect(order).toEqual([
			"acquire",
			"reserve",
			"mark-dispatched",
			"dispatch",
			"settle",
			"release-permit",
		]);
	});

	it("passes both deadlines, their effective value, capped timeout, signal, and pinned profile", async () => {
		const clock = createManualClock(1_000);
		const ledger = ledgerWithLimits();
		const context = createContextFixture({
			clock,
			providerLedger: ledger,
			applicationDeadlineAt: 1_750,
			absoluteJobDeadlineAt: 2_000,
		});
		const semaphore = createSemaphore(1, { clock });
		const dispatch = vi.fn().mockResolvedValue({ usage: "trusted separately" });

		await executeProviderRequest({
			context,
			semaphore,
			reservation: reservation(),
			configuredTimeoutMs: 2_000,
			dispatch,
			getTrustedUsage: () => ({
				inputTokens: 300,
				outputTokens: 100,
				costMicros: 4_000,
			}),
		});

		expect(dispatch).toHaveBeenCalledWith({
			signal: context.signal,
			timeoutMs: 750,
			applicationDeadlineAt: 1_750,
			absoluteJobDeadlineAt: 2_000,
			effectiveDeadlineAt: 1_750,
			modelProfile: context.modelProfile,
		});
		expect(ledger.snapshot().entries[0].state).toBe("reconciled");
		expect(semaphore.activeCount).toBe(0);
	});

	it("releases the permit when budget reservation fails without dispatch", async () => {
		const clock = createManualClock();
		const ledger = ledgerWithLimits({ maxCalls: 1 });
		ledger.reserve(reservation("already-reserved"));
		const context = createContextFixture({ clock, providerLedger: ledger });
		const semaphore = createSemaphore(1, { clock });
		const dispatch = vi.fn();

		await expect(
			executeProviderRequest({
				context,
				semaphore,
				reservation: reservation("blocked"),
				configuredTimeoutMs: 100,
				dispatch,
			}),
		).rejects.toBeInstanceOf(ProcessorBudgetExceededError);
		expect(dispatch).not.toHaveBeenCalled();
		expect(semaphore.activeCount).toBe(0);
	});

	it("releases an undispatched reservation when cancellation wins after reserve", async () => {
		const clock = createManualClock();
		const controller = new AbortController();
		const realLedger = ledgerWithLimits();
		const reason = new ProcessorCancelledError({ stage: "provider" });
		const providerLedger = {
			attemptId: "attempt-1",
			reserve(details) {
				const entry = realLedger.reserve(details);
				controller.abort(reason);
				return entry;
			},
			markDispatched: realLedger.markDispatched,
			releaseUndispatched: realLedger.releaseUndispatched,
			settle: realLedger.settle,
			snapshot: realLedger.snapshot,
		};
		const context = createContextFixture({
			clock,
			controller,
			signal: controller.signal,
			providerLedger,
		});
		const semaphore = createSemaphore(1, { clock });
		const dispatch = vi.fn();

		await expect(
			executeProviderRequest({
				context,
				semaphore,
				reservation: reservation(),
				configuredTimeoutMs: 100,
				dispatch,
			}),
		).rejects.toBe(reason);
		expect(dispatch).not.toHaveBeenCalled();
		expect(realLedger.snapshot().totals.calls).toBe(0);
		expect(realLedger.snapshot().entries[0].state).toBe("released");
		expect(semaphore.activeCount).toBe(0);
	});

	it("retains worst-case exposure after dispatch errors or untrusted usage", async () => {
		const clock = createManualClock();
		const ledger = ledgerWithLimits();
		const context = createContextFixture({ clock, providerLedger: ledger });
		const semaphore = createSemaphore(1, { clock });

		await expect(
			executeProviderRequest({
				context,
				semaphore,
				reservation: reservation(),
				configuredTimeoutMs: 100,
				dispatch: async () => {
					throw new Error("network result unknown");
				},
			}),
		).rejects.toThrow("network result unknown");
		expect(ledger.snapshot().entries[0].state).toBe("retained");
		expect(ledger.snapshot().totals).toEqual({
			calls: 1,
			inputTokens: 1_000,
			outputTokens: 500,
			costMicros: 20_000,
		});
		expect(semaphore.activeCount).toBe(0);
	});

	it("does not let ledger cleanup failure mask the primary dispatch error", async () => {
		const clock = createManualClock();
		const providerLedger = {
			attemptId: "attempt-1",
			reserve: vi.fn(),
			markDispatched: vi.fn(),
			releaseUndispatched: vi.fn(),
			settle: vi.fn(() => {
				throw new Error("ledger unavailable");
			}),
			snapshot: vi.fn(() => ({})),
		};
		const logger = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(() => {
				throw new Error("logger unavailable");
			}),
		};
		const context = createContextFixture({ clock, providerLedger, logger });
		const semaphore = createSemaphore(1, { clock });
		let caught;

		try {
			await executeProviderRequest({
				context,
				semaphore,
				reservation: reservation(),
				configuredTimeoutMs: 100,
				dispatch: async () => {
					throw new Error("primary dispatch failure");
				},
			});
		} catch (error) {
			caught = error;
		}

		expect(caught.message).toBe("primary dispatch failure");
		expect(caught.secondaryErrors.map((entry) => entry.label)).toEqual([
			"Provider ledger cleanup failed.",
			"Secondary failure logging failed.",
		]);
		expect(semaphore.activeCount).toBe(0);
	});

	it("does not let permit release failure mask a primary error", async () => {
		const ledger = ledgerWithLimits();
		const context = createContextFixture({ providerLedger: ledger });
		const releaseError = new Error("release failed");
		const semaphore = {
			acquire: vi.fn(async () => () => {
				throw releaseError;
			}),
		};
		let caught;

		try {
			await executeProviderRequest({
				context,
				semaphore,
				reservation: reservation(),
				configuredTimeoutMs: 100,
				dispatch: async () => {
					throw new Error("primary dispatch failure");
				},
			});
		} catch (error) {
			caught = error;
		}

		expect(caught.message).toBe("primary dispatch failure");
		expect(caught.secondaryErrors).toEqual([
			{ label: "Provider semaphore release failed.", error: releaseError },
		]);
	});

	it("propagates permit release failure when no primary error exists", async () => {
		const ledger = ledgerWithLimits();
		const context = createContextFixture({ providerLedger: ledger });
		const releaseError = new Error("release failed");
		const semaphore = {
			acquire: vi.fn(async () => () => {
				throw releaseError;
			}),
		};

		await expect(
			executeProviderRequest({
				context,
				semaphore,
				reservation: reservation(),
				configuredTimeoutMs: 100,
				dispatch: async () => ({ id: "ok" }),
				getTrustedUsage: () => ({
					inputTokens: 10,
					outputTokens: 10,
					costMicros: 100,
				}),
			}),
		).rejects.toBe(releaseError);
	});

	it("retains worst case when trusted-usage extraction fails", async () => {
		const clock = createManualClock();
		const ledger = ledgerWithLimits();
		const context = createContextFixture({ clock, providerLedger: ledger });
		const semaphore = createSemaphore(1, { clock });

		await expect(
			executeProviderRequest({
				context,
				semaphore,
				reservation: reservation(),
				configuredTimeoutMs: 100,
				dispatch: async () => ({ id: "response" }),
				getTrustedUsage: () => {
					throw new Error("usage parser failed");
				},
			}),
		).rejects.toThrow("usage parser failed");
		expect(ledger.snapshot().entries[0].state).toBe("retained");
		expect(semaphore.activeCount).toBe(0);
	});
});

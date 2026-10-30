import { describe, expect, it, vi } from "vitest";
import { providerSemaphore, renderSemaphore } from "../concurrency.js";
import {
	ProcessorCancelledError,
	ProcessorDeadlineExceededError,
} from "../errors.js";
import { createSemaphore } from "../semaphore.js";
import { createManualClock } from "./testUtils.js";

function options(clock, controller = new AbortController(), delayMs = 1_000) {
	return {
		signal: controller.signal,
		deadlineAt: clock.now() + delayMs,
		stage: "test-wait",
	};
}

describe("abort-aware FIFO semaphore", () => {
	it("never grants beyond its limit", async () => {
		const clock = createManualClock();
		const semaphore = createSemaphore(2, { clock });
		const releaseOne = await semaphore.acquire(options(clock));
		const releaseTwo = await semaphore.acquire(options(clock));
		const third = semaphore.acquire(options(clock));

		expect(semaphore.activeCount).toBe(2);
		expect(semaphore.pendingCount).toBe(1);
		releaseOne();
		const releaseThree = await third;
		expect(semaphore.activeCount).toBe(2);

		releaseTwo();
		releaseThree();
		expect(semaphore.activeCount).toBe(0);
	});

	it("grants queued work in FIFO order", async () => {
		const clock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		const order = [];
		const firstRelease = await semaphore.acquire(options(clock));
		const second = semaphore.acquire(options(clock)).then((release) => {
			order.push("second");
			return release;
		});
		const third = semaphore.acquire(options(clock)).then((release) => {
			order.push("third");
			return release;
		});

		firstRelease();
		const secondRelease = await second;
		expect(order).toEqual(["second"]);
		secondRelease();
		const thirdRelease = await third;
		expect(order).toEqual(["second", "third"]);
		thirdRelease();
		expect(clock.pendingTimers()).toBe(0);
	});

	it("removes a cancelled queued waiter and preserves its control-flow reason", async () => {
		const clock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		const activeRelease = await semaphore.acquire(options(clock));
		const controller = new AbortController();
		const queued = semaphore.acquire(options(clock, controller));
		const reason = new ProcessorCancelledError({ stage: "queued" });

		controller.abort(reason);
		await expect(queued).rejects.toBe(reason);
		expect(semaphore.pendingCount).toBe(0);
		expect(clock.pendingTimers()).toBe(0);
		activeRelease();
		expect(semaphore.activeCount).toBe(0);
	});

	it("expires a queued waiter at its deadline", async () => {
		const clock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		const activeRelease = await semaphore.acquire(options(clock));
		const queued = semaphore.acquire(options(clock, new AbortController(), 25));

		clock.advanceBy(25);
		await expect(queued).rejects.toBeInstanceOf(ProcessorDeadlineExceededError);
		expect(semaphore.pendingCount).toBe(0);
		expect(clock.pendingTimers()).toBe(0);
		activeRelease();
	});

	it("rejects pre-aborted and already-expired acquisition", async () => {
		const clock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		const controller = new AbortController();
		controller.abort();

		await expect(
			semaphore.acquire(options(clock, controller)),
		).rejects.toBeInstanceOf(ProcessorCancelledError);
		await expect(
			semaphore.acquire({
				signal: new AbortController().signal,
				deadlineAt: clock.now(),
			}),
		).rejects.toBeInstanceOf(ProcessorDeadlineExceededError);
		expect(semaphore.activeCount).toBe(0);
	});

	it("makes release idempotent", async () => {
		const clock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		const release = await semaphore.acquire(options(clock));
		release();
		release();
		expect(semaphore.activeCount).toBe(0);
	});

	it("run rechecks cancellation after grant before starting the operation", async () => {
		const clock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		const controller = new AbortController();
		const operation = vi.fn();
		const reason = new ProcessorCancelledError({ stage: "post-grant" });

		const running = semaphore.run(options(clock, controller), operation);
		controller.abort(reason);

		await expect(running).rejects.toBe(reason);
		expect(operation).not.toHaveBeenCalled();
		expect(semaphore.activeCount).toBe(0);
	});

	it("run rechecks the deadline after grant before starting the operation", async () => {
		const clock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		const operation = vi.fn();
		const running = semaphore.run(
			options(clock, new AbortController(), 25),
			operation,
		);
		clock.advanceBy(25);

		await expect(running).rejects.toBeInstanceOf(
			ProcessorDeadlineExceededError,
		);
		expect(operation).not.toHaveBeenCalled();
		expect(semaphore.activeCount).toBe(0);
	});

	it("run releases permits after success and failure", async () => {
		const clock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		await expect(semaphore.run(options(clock), async () => "ok")).resolves.toBe(
			"ok",
		);
		expect(semaphore.activeCount).toBe(0);

		await expect(
			semaphore.run(options(clock), async () => {
				throw new Error("operation failed");
			}),
		).rejects.toThrow("operation failed");
		expect(semaphore.activeCount).toBe(0);
	});

	it("exports one process-wide provider limit of two and render limit of one", () => {
		expect(providerSemaphore.limit).toBe(2);
		expect(renderSemaphore.limit).toBe(1);
		expect(Object.isFrozen(providerSemaphore)).toBe(true);
		expect(Object.isFrozen(renderSemaphore)).toBe(true);
	});
});

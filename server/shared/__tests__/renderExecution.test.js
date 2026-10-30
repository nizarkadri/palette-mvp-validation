import { describe, expect, it, vi } from "vitest";
import {
	ProcessorCancelledError,
	ProcessorDeadlineExceededError,
} from "../errors.js";
import {
	RenderCleanupTimeoutError,
	executeRenderOperation,
} from "../renderExecution.js";
import { createSemaphore } from "../semaphore.js";
import { createContextFixture, createManualClock } from "./testUtils.js";

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe("context-aware render execution coordinator", () => {
	it("uses the process-wide render limit of one under concurrent calls", async () => {
		const contexts = [createContextFixture(), createContextFixture()];
		const gates = [deferred(), deferred()];
		let active = 0;
		let maximumActive = 0;
		const entered = [];

		const calls = contexts.map((context, index) =>
			executeRenderOperation({
				context,
				stage: `render-${index}`,
				operation: async ({ awaitExpensive }) => {
					active += 1;
					maximumActive = Math.max(maximumActive, active);
					entered.push(index);
					await awaitExpensive(`wait-${index}`, () => gates[index].promise);
					active -= 1;
					return index;
				},
			}),
		);

		await vi.waitFor(() => expect(entered).toEqual([0]));
		gates[0].resolve();
		await vi.waitFor(() => expect(entered).toEqual([0, 1]));
		gates[1].resolve();

		await expect(Promise.all(calls)).resolves.toEqual([0, 1]);
		expect(maximumActive).toBe(1);
	});

	it("preserves queued cancellation identity and never starts cancelled work", async () => {
		const firstGate = deferred();
		const first = executeRenderOperation({
			context: createContextFixture(),
			stage: "first-render",
			operation: ({ awaitExpensive }) =>
				awaitExpensive("first-wait", () => firstGate.promise),
		});
		const controller = new AbortController();
		const secondContext = createContextFixture({
			controller,
			signal: controller.signal,
		});
		const secondOperation = vi.fn();
		const second = executeRenderOperation({
			context: secondContext,
			stage: "second-render",
			operation: secondOperation,
		});
		const reason = new ProcessorCancelledError({ stage: "second-render" });
		controller.abort(reason);

		await expect(second).rejects.toBe(reason);
		expect(secondOperation).not.toHaveBeenCalled();
		firstGate.resolve("done");
		await expect(first).resolves.toBe("done");
	});

	it("checks active state after every expensive await", async () => {
		const controller = new AbortController();
		const context = createContextFixture({
			controller,
			signal: controller.signal,
		});
		const reason = new ProcessorCancelledError({ stage: "browser-launch" });

		const call = executeRenderOperation({
			context,
			operation: ({ awaitExpensive }) =>
				awaitExpensive("browser-launch", async () => {
					controller.abort(reason);
					return "browser";
				}),
		});

		await expect(call).rejects.toBe(reason);
	});

	it("releases a permit when an in-flight operation hangs and cancellation wins", async () => {
		const clock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		const controller = new AbortController();
		const firstContext = createContextFixture({
			clock,
			controller,
			signal: controller.signal,
		});
		const entered = vi.fn();
		const hungOperation = vi.fn(() => new Promise(() => {}));
		const first = executeRenderOperation({
			context: firstContext,
			semaphore,
			operation: ({ awaitExpensive }) =>
				awaitExpensive("hung-content", hungOperation),
		});
		const second = executeRenderOperation({
			context: createContextFixture({ clock }),
			semaphore,
			operation: () => {
				entered();
				return "queued render";
			},
		});
		await vi.waitFor(() => expect(hungOperation).toHaveBeenCalledOnce());
		const reason = new ProcessorCancelledError({ stage: "hung-content" });
		controller.abort(reason);

		await expect(first).rejects.toBe(reason);
		await expect(second).resolves.toBe("queued render");
		expect(entered).toHaveBeenCalledOnce();
		expect(semaphore.activeCount).toBe(0);
	});

	it("releases a permit when an in-flight operation hangs past its deadline", async () => {
		const clock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		const firstContext = createContextFixture({
			clock,
			applicationDeadlineAt: clock.now() + 25,
			absoluteJobDeadlineAt: clock.now() + 50,
		});
		const hungOperation = vi.fn(() => new Promise(() => {}));
		const first = executeRenderOperation({
			context: firstContext,
			semaphore,
			operation: ({ awaitExpensive }) =>
				awaitExpensive("hung-measure", hungOperation),
		});
		const second = executeRenderOperation({
			context: createContextFixture({ clock }),
			semaphore,
			operation: () => "queued after deadline",
		});
		await vi.waitFor(() => expect(hungOperation).toHaveBeenCalledOnce());
		clock.advanceBy(25);

		await expect(first).rejects.toBeInstanceOf(ProcessorDeadlineExceededError);
		await expect(second).resolves.toBe("queued after deadline");
		expect(semaphore.activeCount).toBe(0);
	});

	it("closes a page that resolves after cancellation exactly once", async () => {
		const clock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		const controller = new AbortController();
		const context = createContextFixture({
			clock,
			controller,
			signal: controller.signal,
		});
		const pageGate = deferred();
		const createPage = vi.fn(() => pageGate.promise);
		const page = { close: vi.fn().mockResolvedValue(undefined) };
		const reason = new ProcessorCancelledError({ stage: "new-page" });

		const call = executeRenderOperation({
			context,
			semaphore,
			operation: ({ awaitExpensive, deferCleanup }) =>
				awaitExpensive("new-page", createPage, {
					onResolved: (resolvedPage) =>
						deferCleanup("page close", () => resolvedPage.close()),
				}),
		});
		await vi.waitFor(() => expect(createPage).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(call).rejects.toBe(reason);
		expect(semaphore.activeCount).toBe(0);
		pageGate.resolve(page);
		await vi.waitFor(() => expect(page.close).toHaveBeenCalledOnce());
		await Promise.resolve();
		expect(page.close).toHaveBeenCalledOnce();
	});

	it("bounds cleanup for an acquired page when a later Chromium await hangs", async () => {
		const clock = createManualClock();
		const cleanupClock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		const controller = new AbortController();
		const context = createContextFixture({
			clock,
			controller,
			signal: controller.signal,
		});
		const page = { close: vi.fn(() => new Promise(() => {})) };
		const hungScreenshot = vi.fn(() => new Promise(() => {}));
		const first = executeRenderOperation({
			context,
			semaphore,
			cleanupClock,
			cleanupTimeoutMs: 20,
			operation: async ({ awaitExpensive, deferCleanup }) => {
				await awaitExpensive("new-page", () => Promise.resolve(page), {
					onResolved: (resolvedPage) =>
						deferCleanup("page close", () => resolvedPage.close()),
				});
				return awaitExpensive("hung-screenshot", hungScreenshot);
			},
		});
		const secondOperation = vi.fn(() => "next render");
		const second = executeRenderOperation({
			context: createContextFixture({ clock }),
			semaphore,
			operation: secondOperation,
		});
		await vi.waitFor(() => expect(hungScreenshot).toHaveBeenCalledOnce());
		const reason = new ProcessorCancelledError({ stage: "hung-screenshot" });
		controller.abort(reason);
		await vi.waitFor(() => expect(page.close).toHaveBeenCalledOnce());
		expect(secondOperation).not.toHaveBeenCalled();
		cleanupClock.advanceBy(20);

		await expect(first).rejects.toBe(reason);
		await expect(second).resolves.toBe("next render");
		expect(semaphore.activeCount).toBe(0);
	});

	it("observes a late rejection after cancellation without changing control-flow identity", async () => {
		const clock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		const controller = new AbortController();
		const context = createContextFixture({
			clock,
			controller,
			signal: controller.signal,
		});
		const gate = deferred();
		const unhandled = vi.fn();
		process.on("unhandledRejection", unhandled);
		try {
			const hungOperation = vi.fn(() => gate.promise);
			const call = executeRenderOperation({
				context,
				semaphore,
				operation: ({ awaitExpensive }) =>
					awaitExpensive("hung-content", hungOperation),
			});
			await vi.waitFor(() => expect(hungOperation).toHaveBeenCalledOnce());
			const reason = new ProcessorCancelledError({ stage: "hung-content" });
			controller.abort(reason);
			await expect(call).rejects.toBe(reason);
			gate.reject(new Error("late Chromium rejection"));
			await new Promise((resolve) => setImmediate(resolve));
			expect(unhandled).not.toHaveBeenCalled();
			expect(semaphore.activeCount).toBe(0);
		} finally {
			process.off("unhandledRejection", unhandled);
		}
	});

	it("caps supported browser waits by effective remaining time", async () => {
		const clock = createManualClock(1_000);
		const context = createContextFixture({
			clock,
			applicationDeadlineAt: 1_450,
			absoluteJobDeadlineAt: 2_000,
		});

		const timeout = await executeRenderOperation({
			context,
			semaphore: createSemaphore(1, { clock }),
			operation: ({ capWaitTimeoutMs }) =>
				capWaitTimeoutMs(10_000, "page-content"),
		});

		expect(timeout).toBe(450);
	});

	it("releases permits on operation and cleanup failures", async () => {
		const clock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		const cleanupError = new Error("cleanup failed");

		await expect(
			executeRenderOperation({
				context: createContextFixture({ clock }),
				semaphore,
				operation: ({ deferCleanup }) => {
					deferCleanup("page close failed", () => {
						throw cleanupError;
					});
					return "ok";
				},
			}),
		).rejects.toBe(cleanupError);
		expect(semaphore.activeCount).toBe(0);
	});

	it("bounds cancelled-work cleanup, preserves the primary, and releases the permit", async () => {
		const clock = createManualClock();
		const cleanupClock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		const primary = new ProcessorCancelledError({ stage: "render" });
		const never = new Promise(() => {});
		const call = executeRenderOperation({
			context: createContextFixture({ clock }),
			semaphore,
			cleanupClock,
			cleanupTimeoutMs: 25,
			operation: ({ deferCleanup }) => {
				deferCleanup("stuck page close", () => never);
				throw primary;
			},
		});

		await vi.waitFor(() => expect(cleanupClock.pendingTimers()).toBe(1));
		cleanupClock.advanceBy(25);
		await expect(call).rejects.toBe(primary);
		expect(primary.secondaryErrors).toEqual([
			{
				label: "stuck page close",
				error: expect.any(RenderCleanupTimeoutError),
			},
		]);
		expect(semaphore.activeCount).toBe(0);

		await expect(
			executeRenderOperation({
				context: createContextFixture({ clock }),
				semaphore,
				operation: () => "next render",
			}),
		).resolves.toBe("next render");
	});

	it("keeps the primary error when cleanup and logging also fail", async () => {
		const clock = createManualClock();
		const semaphore = createSemaphore(1, { clock });
		const primary = new Error("primary render failure");
		const cleanup = new Error("page close failure");
		const logger = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(() => {
				throw new Error("logger failure");
			}),
		};
		let caught;

		try {
			await executeRenderOperation({
				context: createContextFixture({ clock, logger }),
				semaphore,
				operation: ({ deferCleanup }) => {
					deferCleanup("page close failed", () => {
						throw cleanup;
					});
					throw primary;
				},
			});
		} catch (error) {
			caught = error;
		}

		expect(caught).toBe(primary);
		expect(caught.secondaryErrors).toEqual([
			{ label: "page close failed", error: cleanup },
			{
				label: "Secondary failure logging failed.",
				error: expect.objectContaining({ message: "logger failure" }),
			},
		]);
		expect(semaphore.activeCount).toBe(0);
	});
});

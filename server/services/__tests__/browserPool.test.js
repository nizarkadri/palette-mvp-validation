import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("playwright", () => ({
	chromium: { launch: mocks.launch },
}));

import {
	ProcessorCancelledError,
	ProcessorDeadlineExceededError,
} from "../../shared/errors.js";
import { createManualClock } from "../../shared/__tests__/testUtils.js";
import { getScreenshotBrowser } from "../browserPool.js";

function deferred() {
	let resolve;
	const promise = new Promise((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("shared screenshot browser launch", () => {
	it("gives each processor a bounded wait without cancelling the global launch", async () => {
		const launch = deferred();
		const browser = {
			isConnected: vi.fn(() => true),
			on: vi.fn(),
			close: vi.fn().mockResolvedValue(undefined),
		};
		mocks.launch.mockReturnValueOnce(launch.promise);
		const longClock = createManualClock(1_000);
		const shortClock = createManualClock(5_000);
		const longWait = getScreenshotBrowser({
			signal: new AbortController().signal,
			deadlineAt: 11_000,
			clock: longClock,
			stage: "long-browser",
			timeoutMs: 10_000,
		});
		const shortWait = getScreenshotBrowser({
			signal: new AbortController().signal,
			deadlineAt: 5_020,
			clock: shortClock,
			stage: "short-browser",
			timeoutMs: 20,
		});
		const cancelledController = new AbortController();
		const cancelledWait = getScreenshotBrowser({
			signal: cancelledController.signal,
			deadlineAt: 11_000,
			clock: longClock,
			stage: "cancelled-browser",
			timeoutMs: 10_000,
		});
		const timeoutClock = createManualClock(20_000);
		const configuredTimeoutWait = getScreenshotBrowser({
			signal: new AbortController().signal,
			deadlineAt: 30_000,
			clock: timeoutClock,
			stage: "configured-timeout-browser",
			timeoutMs: 10,
		});

		const cancellation = new ProcessorCancelledError({
			stage: "cancelled-browser",
		});
		cancelledController.abort(cancellation);
		await expect(cancelledWait).rejects.toBe(cancellation);
		timeoutClock.advanceBy(10);
		await expect(configuredTimeoutWait).rejects.toThrow(
			"Timed out waiting for the shared browser launch.",
		);
		shortClock.advanceBy(20);
		await expect(shortWait).rejects.toBeInstanceOf(
			ProcessorDeadlineExceededError,
		);
		expect(mocks.launch).toHaveBeenCalledOnce();

		launch.resolve(browser);
		await expect(longWait).resolves.toBe(browser);
		expect(mocks.launch).toHaveBeenCalledOnce();
	});
});

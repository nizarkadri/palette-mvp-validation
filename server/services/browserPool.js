import { chromium } from "playwright";
import { remainingTimeMs, systemClock, validateClock } from "../shared/deadlines.js";
import {
	ProcessorDeadlineExceededError,
	throwIfAborted,
} from "../shared/errors.js";

const GLOBAL_BROWSER_LAUNCH_TIMEOUT_MS = 30_000;

let screenshotBrowser = null;
let screenshotBrowserPromise = null;
let screenshotBrowserShutdownHooksRegistered = false;

function registerScreenshotBrowserShutdownHooks() {
	if (screenshotBrowserShutdownHooksRegistered) return;
	screenshotBrowserShutdownHooksRegistered = true;

	const closeForSignal = async (signal) => {
		await closeScreenshotBrowser();
		process.kill(process.pid, signal);
	};

	process.once("SIGINT", () => {
		void closeForSignal("SIGINT");
	});
	process.once("SIGTERM", () => {
		void closeForSignal("SIGTERM");
	});
	process.once("beforeExit", () => {
		if (screenshotBrowser || screenshotBrowserPromise) {
			void closeScreenshotBrowser();
		}
	});
}

function rememberScreenshotBrowser(browser) {
	screenshotBrowser = browser;
	browser.on("disconnected", () => {
		if (screenshotBrowser === browser) screenshotBrowser = null;
		screenshotBrowserPromise = null;
	});
	return browser;
}

function waitForSharedLaunch(
	launchPromise,
	{
		signal,
		deadlineAt,
		clock = systemClock,
		stage = "browser-launch",
		timeoutMs,
	} = {},
) {
	if (signal === undefined && deadlineAt === undefined && timeoutMs === undefined) {
		return launchPromise;
	}
	validateClock(clock);
	if (signal) throwIfAborted(signal, stage);

	const deadlineRemaining =
		deadlineAt === undefined ? Number.POSITIVE_INFINITY : remainingTimeMs(deadlineAt, clock);
	if (deadlineRemaining <= 0) {
		throw new ProcessorDeadlineExceededError({ stage });
	}
	const configuredRemaining =
		Number.isFinite(timeoutMs) && timeoutMs > 0
			? timeoutMs
			: Number.POSITIVE_INFINITY;
	const waitMs = Math.min(deadlineRemaining, configuredRemaining);
	if (!Number.isFinite(waitMs)) return launchPromise;

	return new Promise((resolve, reject) => {
		let settled = false;
		let timer = null;
		const cleanup = () => {
			if (timer !== null) clock.clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};
		const settle = (handler, value) => {
			if (settled) return;
			settled = true;
			cleanup();
			handler(value);
		};
		const onAbort = () => {
			try {
				throwIfAborted(signal, stage);
			} catch (error) {
				settle(reject, error);
			}
		};

		launchPromise.then(
			(browser) => settle(resolve, browser),
			(error) => settle(reject, error),
		);
		signal?.addEventListener("abort", onAbort, { once: true });
		timer = clock.setTimeout(() => {
			if (deadlineAt !== undefined && remainingTimeMs(deadlineAt, clock) <= 0) {
				settle(reject, new ProcessorDeadlineExceededError({ stage }));
				return;
			}
			settle(reject, new Error("Timed out waiting for the shared browser launch."));
		}, Math.max(1, Math.ceil(waitMs)));
		if (signal?.aborted) onAbort();
	});
}

export async function getScreenshotBrowser(options = {}) {
	registerScreenshotBrowserShutdownHooks();
	if (screenshotBrowser?.isConnected()) {
		return waitForSharedLaunch(Promise.resolve(screenshotBrowser), options);
	}
	if (!screenshotBrowserPromise) {
		// Launch lifetime is process-owned. Individual processor callers only race
		// their own wait and never shorten/cancel this shared launch.
		screenshotBrowserPromise = chromium
			.launch({ headless: true, timeout: GLOBAL_BROWSER_LAUNCH_TIMEOUT_MS })
			.then(rememberScreenshotBrowser)
			.catch((error) => {
				screenshotBrowserPromise = null;
				throw error;
			});
	}
	return waitForSharedLaunch(screenshotBrowserPromise, options);
}

async function closeScreenshotBrowser() {
	const browser =
		screenshotBrowser || (await screenshotBrowserPromise?.catch(() => null));
	screenshotBrowser = null;
	screenshotBrowserPromise = null;
	if (browser?.isConnected()) {
		try {
			await browser.close();
		} catch {
			// Process shutdown cleanup is best-effort.
		}
	}
}

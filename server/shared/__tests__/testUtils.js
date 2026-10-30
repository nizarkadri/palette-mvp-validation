import { vi } from "vitest";
import { resolveModelProfile } from "../modelProfiles.js";
import { createProviderLedger } from "../providerLedger.js";
import { createProcessorContext } from "../processorContext.js";

export function createManualClock(initialNow = 1_000) {
	let now = initialNow;
	let nextId = 1;
	const timers = new Map();

	function runDueTimers() {
		while (true) {
			const due = [...timers.entries()]
				.filter(([, timer]) => timer.at <= now)
				.sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
			if (due.length === 0) return;
			const [id, timer] = due[0];
			timers.delete(id);
			timer.callback();
		}
	}

	return {
		now: () => now,
		setTimeout(callback, delayMs) {
			const id = nextId;
			nextId += 1;
			timers.set(id, { at: now + delayMs, callback });
			return id;
		},
		clearTimeout(id) {
			timers.delete(id);
		},
		advanceBy(delayMs) {
			now += delayMs;
			runDueTimers();
		},
		pendingTimers() {
			return timers.size;
		},
	};
}

export function createContextFixture(overrides = {}) {
	const clock = overrides.clock || createManualClock();
	const controller = overrides.controller || new AbortController();
	const canonicalDefaultProfile = resolveModelProfile("analysis", "default");
	const modelProfile = overrides.modelProfile || canonicalDefaultProfile;
	const providerLedger = createProviderLedger({
		attemptId: "attempt-1",
		...canonicalDefaultProfile.attemptLedgerCeilings,
	});
	const logger = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
	const diagnostics = { record: vi.fn() };
	const artifactStore = { create: vi.fn() };
	const checkpointStore = { createCompleted: vi.fn() };

	return createProcessorContext({
		identity: { jobId: "job-1", attemptId: "attempt-1", fenceToken: 7 },
		signal: controller.signal,
		applicationDeadlineAt: clock.now() + 10_000,
		absoluteJobDeadlineAt: clock.now() + 20_000,
		providerLedger,
		modelProfile,
		modelProfileRevision: modelProfile.revision,
		logger,
		reportProgress: vi.fn(),
		emitProcessorEvent: vi.fn(),
		diagnostics,
		artifactStore,
		checkpointStore,
		clock,
		...overrides,
	});
}

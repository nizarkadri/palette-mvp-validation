import { ProcessorDeadlineExceededError } from "./errors.js";

export const systemClock = Object.freeze({
	now: () => Date.now(),
	setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
	clearTimeout: (timer) => clearTimeout(timer),
});

function requireClock(clock) {
	if (
		!clock ||
		typeof clock.now !== "function" ||
		typeof clock.setTimeout !== "function" ||
		typeof clock.clearTimeout !== "function"
	) {
		throw new TypeError(
			"clock must provide now(), setTimeout(), and clearTimeout().",
		);
	}
	return clock;
}

function requireDeadline(value, name) {
	if (!Number.isFinite(value)) {
		throw new TypeError(`${name} must be a finite epoch-millisecond number.`);
	}
	return value;
}

export function effectiveDeadlineAt({
	applicationDeadlineAt,
	absoluteJobDeadlineAt,
}) {
	return Math.min(
		requireDeadline(applicationDeadlineAt, "applicationDeadlineAt"),
		requireDeadline(absoluteJobDeadlineAt, "absoluteJobDeadlineAt"),
	);
}

export function remainingTimeMs(deadlineAt, clock = systemClock) {
	requireClock(clock);
	const now = clock.now();
	if (!Number.isFinite(now)) {
		throw new TypeError("clock.now() must return a finite epoch-millisecond number.");
	}
	return requireDeadline(deadlineAt, "deadlineAt") - now;
}

export function throwIfDeadlineExceeded(
	deadlineAt,
	clock = systemClock,
	stage,
) {
	if (remainingTimeMs(deadlineAt, clock) <= 0) {
		throw new ProcessorDeadlineExceededError({ stage });
	}
}

export function capTimeoutMs(
	configuredTimeoutMs,
	deadlineAt,
	clock = systemClock,
	stage,
) {
	if (!Number.isFinite(configuredTimeoutMs) || configuredTimeoutMs <= 0) {
		throw new TypeError(
			"configuredTimeoutMs must be a positive finite number.",
		);
	}
	const remaining = remainingTimeMs(deadlineAt, clock);
	if (remaining <= 0) {
		throw new ProcessorDeadlineExceededError({ stage });
	}
	return Math.max(1, Math.min(configuredTimeoutMs, Math.floor(remaining)));
}

export function validateClock(clock) {
	return requireClock(clock);
}

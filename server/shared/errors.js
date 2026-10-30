export const CONTROL_FLOW_CODES = Object.freeze({
	CANCELLED: "CANCELLED",
	DEADLINE_EXCEEDED: "DEADLINE_EXCEEDED",
	BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
	LEASE_LOST: "LEASE_LOST",
	FENCE_LOST: "FENCE_LOST",
	SHUTDOWN: "SHUTDOWN",
});

const SAFE_MESSAGES = Object.freeze({
	[CONTROL_FLOW_CODES.CANCELLED]: "Processor execution was cancelled.",
	[CONTROL_FLOW_CODES.DEADLINE_EXCEEDED]: "Processor deadline was exceeded.",
	[CONTROL_FLOW_CODES.BUDGET_EXCEEDED]: "Processor budget was exceeded.",
	[CONTROL_FLOW_CODES.LEASE_LOST]: "Processor lease was lost.",
	[CONTROL_FLOW_CODES.FENCE_LOST]: "Processor fence was lost.",
	[CONTROL_FLOW_CODES.SHUTDOWN]: "Processor execution stopped for shutdown.",
});

const CONTROL_FLOW_CODE_SET = new Set(Object.values(CONTROL_FLOW_CODES));

export class ProcessorControlFlowError extends Error {
	constructor(code, { cause, stage } = {}) {
		if (!CONTROL_FLOW_CODE_SET.has(code)) {
			throw new TypeError(`Unknown processor control-flow code: ${code}`);
		}
		super(SAFE_MESSAGES[code], cause === undefined ? {} : { cause });
		this.name = "ProcessorControlFlowError";
		this.code = code;
		this.safeMessage = SAFE_MESSAGES[code];
		this.stage =
			typeof stage === "string" && stage.trim() ? stage.trim() : null;
	}
}

export class ProcessorCancelledError extends ProcessorControlFlowError {
	constructor(options) {
		super(CONTROL_FLOW_CODES.CANCELLED, options);
		this.name = "ProcessorCancelledError";
	}
}

export class ProcessorDeadlineExceededError extends ProcessorControlFlowError {
	constructor(options) {
		super(CONTROL_FLOW_CODES.DEADLINE_EXCEEDED, options);
		this.name = "ProcessorDeadlineExceededError";
	}
}

export class ProcessorBudgetExceededError extends ProcessorControlFlowError {
	constructor(options) {
		super(CONTROL_FLOW_CODES.BUDGET_EXCEEDED, options);
		this.name = "ProcessorBudgetExceededError";
	}
}

export class ProcessorLeaseLostError extends ProcessorControlFlowError {
	constructor(options) {
		super(CONTROL_FLOW_CODES.LEASE_LOST, options);
		this.name = "ProcessorLeaseLostError";
	}
}

export class ProcessorFenceLostError extends ProcessorControlFlowError {
	constructor(options) {
		super(CONTROL_FLOW_CODES.FENCE_LOST, options);
		this.name = "ProcessorFenceLostError";
	}
}

export class ProcessorShutdownError extends ProcessorControlFlowError {
	constructor(options) {
		super(CONTROL_FLOW_CODES.SHUTDOWN, options);
		this.name = "ProcessorShutdownError";
	}
}

export function isProcessorControlFlowError(error) {
	return (
		error instanceof ProcessorControlFlowError &&
		CONTROL_FLOW_CODE_SET.has(error.code)
	);
}

export function rethrowIfProcessorControlFlow(error) {
	if (isProcessorControlFlowError(error)) throw error;
}

export function throwIfAborted(signal, stage) {
	if (!signal || typeof signal.aborted !== "boolean") {
		throw new TypeError("A valid AbortSignal is required.");
	}
	if (!signal.aborted) return;
	if (isProcessorControlFlowError(signal.reason)) throw signal.reason;
	throw new ProcessorCancelledError({ cause: signal.reason, stage });
}

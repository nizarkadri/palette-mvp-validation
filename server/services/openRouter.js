import {
	JSON_REPAIR_SYSTEM_PROMPT,
	buildJsonRepairUserPrompt,
} from "../../src/prompts/index.js";
import { rethrowIfProcessorControlFlow } from "../shared/errors.js";
import { isCanonicalProviderDescriptor } from "../shared/modelProfiles.js";
import { executeProviderRequest } from "../shared/providerExecution.js";
import { assertProcessorActive } from "../shared/processorContext.js";
import { parseJsonObject } from "../utils/html.js";

const DEFAULT_OPENROUTER_TIMEOUT_MS = 120_000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_REFERER = "http://localhost:5173";
const OPENROUTER_TITLE = "UI Palette Explorer";

export const PROVIDER_FAILURE_CODES = Object.freeze({
	TIMEOUT: "PROVIDER_TIMEOUT",
	HTTP: "PROVIDER_HTTP_ERROR",
	HTTP_RETRYABLE: "PROVIDER_HTTP_RETRYABLE",
	RESPONSE: "PROVIDER_RESPONSE_ERROR",
	TRANSPORT: "PROVIDER_TRANSPORT_ERROR",
});

const PROVIDER_SAFE_MESSAGES = Object.freeze({
	[PROVIDER_FAILURE_CODES.TIMEOUT]: "The model provider request timed out.",
	[PROVIDER_FAILURE_CODES.HTTP]: "The model provider permanently rejected the request.",
	[PROVIDER_FAILURE_CODES.HTTP_RETRYABLE]: "The model provider is temporarily unavailable.",
	[PROVIDER_FAILURE_CODES.RESPONSE]: "The model provider returned an invalid response.",
	[PROVIDER_FAILURE_CODES.TRANSPORT]: "The model provider request failed.",
});

export class ProviderInputLimitError extends Error {
	constructor() {
		super("Provider request input exceeds the configured limit.");
		this.name = "ProviderInputLimitError";
		this.code = "PROVIDER_INPUT_LIMIT_EXCEEDED";
		this.safeMessage = this.message;
	}
}

/** A safe, explicitly degradable provider-boundary failure. */
export class ProviderRequestError extends Error {
	constructor(code, { cause, httpStatus } = {}) {
		if (!Object.hasOwn(PROVIDER_SAFE_MESSAGES, code)) {
			throw new TypeError(`Unknown provider failure code: ${code}`);
		}
		super(PROVIDER_SAFE_MESSAGES[code], cause === undefined ? {} : { cause });
		this.name = "ProviderRequestError";
		this.code = code;
		this.safeMessage = PROVIDER_SAFE_MESSAGES[code];
		this.retryable =
			code === PROVIDER_FAILURE_CODES.TIMEOUT ||
			code === PROVIDER_FAILURE_CODES.HTTP_RETRYABLE ||
			code === PROVIDER_FAILURE_CODES.TRANSPORT;
		this.httpStatus = Number.isInteger(httpStatus) ? httpStatus : null;
	}
}

function extractModelText(data) {
	const content = data?.choices?.[0]?.message?.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((part) => part?.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join("\n");
	}
	return "";
}

function tagProviderFailure(error, code, { httpStatus } = {}) {
	if (error && (typeof error === "object" || typeof error === "function")) {
		try {
			Object.defineProperties(error, {
				providerFailureCode: { value: code, enumerable: false },
				providerHttpStatus: {
					value: Number.isInteger(httpStatus) ? httpStatus : null,
					enumerable: false,
				},
			});
			return error;
		} catch {
			// A sealed/frozen foreign transport rejection cannot be tagged. Wrap it
			// so the processor boundary never leaks an unclassified raw rejection.
		}
	}
	const wrapped = new Error("OpenRouter request failed.", { cause: error });
	Object.defineProperties(wrapped, {
		providerFailureCode: { value: code, enumerable: false },
		providerHttpStatus: {
			value: Number.isInteger(httpStatus) ? httpStatus : null,
			enumerable: false,
		},
	});
	return wrapped;
}

function throwProviderPhaseFailure(
	error,
	{ callerSignal, timeoutSignal, timeoutMs, fallbackCode },
) {
	if (callerSignal?.aborted) {
		rethrowIfProcessorControlFlow(callerSignal.reason);
		throw tagProviderFailure(
			new Error("OpenRouter request was cancelled.", { cause: error }),
			PROVIDER_FAILURE_CODES.TRANSPORT,
		);
	}
	if (timeoutSignal.aborted) {
		throw tagProviderFailure(
			new Error(`OpenRouter request timed out after ${timeoutMs}ms.`, {
				cause: error,
			}),
			PROVIDER_FAILURE_CODES.TIMEOUT,
		);
	}
	throw tagProviderFailure(error, fallbackCode);
}

function httpFailureCode(status) {
	return status === 408 || status === 429 || (status >= 500 && status <= 599)
		? PROVIDER_FAILURE_CODES.HTTP_RETRYABLE
		: PROVIDER_FAILURE_CODES.HTTP;
}

function openRouterRequestSignals(options) {
	const timeoutMs = options.timeoutMs ?? DEFAULT_OPENROUTER_TIMEOUT_MS;
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new TypeError("OpenRouter timeoutMs must be a positive number.");
	}

	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	return {
		timeoutMs,
		timeoutSignal,
		requestSignal: options.signal
			? AbortSignal.any([options.signal, timeoutSignal])
			: timeoutSignal,
	};
}

/**
 * Legacy low-level transport. Its argument shape and HTTP request shape remain
 * available until route migration. Processor-aware callers must use
 * callOpenRouterForProcessor instead.
 */
function openRouterRequestBody(modelId, messages, maxTokens, options) {
	return {
		model: modelId,
		max_tokens: maxTokens,
		...(typeof options.temperature === "number"
			? { temperature: options.temperature }
			: {}),
		...(options.json === false
			? {}
			: { response_format: { type: "json_object" } }),
		...(options.tools ? { tools: options.tools } : {}),
		...(options.tool_choice ? { tool_choice: options.tool_choice } : {}),
		messages,
	};
}

function serializeOpenRouterRequestBody(modelId, messages, maxTokens, options) {
	const serialized = JSON.stringify(
		openRouterRequestBody(modelId, messages, maxTokens, options),
	);
	if (typeof serialized !== "string") {
		throw new TypeError("Provider request input must be JSON serializable.");
	}
	return serialized;
}

async function callOpenRouterWithSerializedBody(
	apiKey,
	serializedBody,
	options,
	requestSignals = openRouterRequestSignals(options),
) {
	const { timeoutMs, timeoutSignal, requestSignal } = requestSignals;
	let upstream;
	try {
		upstream = await fetch(OPENROUTER_URL, {
			method: "POST",
			signal: requestSignal,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"HTTP-Referer": OPENROUTER_REFERER,
				"X-Title": OPENROUTER_TITLE,
			},
			body: serializedBody,
		});
	} catch (error) {
		throwProviderPhaseFailure(error, {
			callerSignal: options.signal,
			timeoutSignal,
			timeoutMs,
			fallbackCode: PROVIDER_FAILURE_CODES.TRANSPORT,
		});
	}

	let data;
	try {
		data = await upstream.json();
	} catch (error) {
		if (options.signal?.aborted || timeoutSignal.aborted) {
			throwProviderPhaseFailure(error, {
				callerSignal: options.signal,
				timeoutSignal,
				timeoutMs,
				fallbackCode: PROVIDER_FAILURE_CODES.RESPONSE,
			});
		}
		if (upstream.ok) {
			throw tagProviderFailure(error, PROVIDER_FAILURE_CODES.RESPONSE);
		}
		// An unreadable non-success body does not override status classification.
		data = {};
	}
	if (!upstream.ok) {
		const code = httpFailureCode(upstream.status);
		throw tagProviderFailure(
			new Error("OpenRouter request failed."),
			code,
			{ httpStatus: upstream.status },
		);
	}

	const choice = data?.choices?.[0];
	const finishReason = choice?.finish_reason;
	const nativeFinishReason = choice?.native_finish_reason;
	if (finishReason === "error") {
		throw tagProviderFailure(
			new Error(
				`Model stopped with error${nativeFinishReason ? ` (${nativeFinishReason})` : ""}.`,
			),
			PROVIDER_FAILURE_CODES.RESPONSE,
		);
	}

	const text = extractModelText(data);
	const toolCalls = choice?.message?.tool_calls || [];
	if (!text && toolCalls.length === 0) {
		throw tagProviderFailure(
			new Error("Model returned no text response."),
			PROVIDER_FAILURE_CODES.RESPONSE,
		);
	}
	return { data, text };
}

export async function callOpenRouter(
	apiKey,
	modelId,
	messages,
	maxTokens = 12000,
	options = {},
) {
	// Preserve legacy validation/timer setup ordering before body serialization.
	const requestSignals = openRouterRequestSignals(options);
	let serializedBody;
	try {
		serializedBody = serializeOpenRouterRequestBody(
			modelId,
			messages,
			maxTokens,
			options,
		);
	} catch (error) {
		// Keep legacy serialization failures classified as transport failures.
		throwProviderPhaseFailure(error, {
			callerSignal: options.signal,
			timeoutSignal: requestSignals.timeoutSignal,
			timeoutMs: requestSignals.timeoutMs,
			fallbackCode: PROVIDER_FAILURE_CODES.TRANSPORT,
		});
	}
	return callOpenRouterWithSerializedBody(
		apiKey,
		serializedBody,
		options,
		requestSignals,
	);
}

function containsByIdentity(root, expected, seen = new Set()) {
	if (root === expected) return true;
	if (!root || typeof root !== "object" || seen.has(root)) return false;
	seen.add(root);
	return Object.values(root).some((value) =>
		containsByIdentity(value, expected, seen),
	);
}

function validateProviderDescriptor(context, provider) {
	if (!provider || typeof provider !== "object" || !Object.isFrozen(provider)) {
		throw new TypeError("A frozen server-owned provider descriptor is required.");
	}
	if (!isCanonicalProviderDescriptor(provider)) {
		throw new TypeError("A canonical server-owned provider descriptor is required.");
	}
	if (!containsByIdentity(context?.modelProfile, provider)) {
		throw new TypeError("Provider descriptor is not owned by the processor profile.");
	}
	if (
		provider.providerId !== "openrouter" ||
		typeof provider.modelId !== "string" ||
		!provider.modelId.trim()
	) {
		throw new TypeError("Invalid OpenRouter provider descriptor.");
	}
	if (!provider.worstCaseReservation || !provider.requestCeilings) {
		throw new TypeError("Provider descriptor is missing request ceilings.");
	}
	return provider;
}

function requireRequestMetadata(kind, stage) {
	if (typeof kind !== "string" || !kind.trim()) {
		throw new TypeError("Provider request kind is required.");
	}
	if (typeof stage !== "string" || !stage.trim()) {
		throw new TypeError("Provider request stage is required.");
	}
	return { kind: kind.trim(), stage: stage.trim() };
}

export function createProviderRequestIdFactory({ attemptId, prefix = "provider" } = {}) {
	if (typeof attemptId !== "string" || !attemptId.trim()) {
		throw new TypeError("Provider request-id factory requires an attemptId.");
	}
	const safePrefix = String(prefix || "provider").replace(/[^a-zA-Z0-9_-]/g, "-");
	let counter = 0;
	return function nextProviderRequestId({ kind = "request" } = {}) {
		counter += 1;
		const safeKind = String(kind || "request").replace(/[^a-zA-Z0-9_-]/g, "-");
		return `${attemptId.trim()}:${safePrefix}:${safeKind}:${counter}`;
	};
}

function trustedOpenRouterUsage(response) {
	const usage = response?.data?.usage;
	if (!usage || typeof usage !== "object") return undefined;
	const inputTokens = usage.prompt_tokens;
	const outputTokens = usage.completion_tokens;
	let costMicros = usage.cost_micros;
	if (
		costMicros === undefined &&
		typeof usage.cost === "number" &&
		Number.isFinite(usage.cost) &&
		usage.cost >= 0
	) {
		costMicros = Math.ceil(usage.cost * 1_000_000);
	}
	if (
		![inputTokens, outputTokens, costMicros].every(
			(value) => Number.isSafeInteger(value) && value >= 0,
		)
	) {
		return undefined;
	}
	return { inputTokens, outputTokens, costMicros };
}

function classifyProviderError(error, context, stage) {
	rethrowIfProcessorControlFlow(error);
	// Recheck cancellation and the effective processor deadline with the
	// processor's clock seam. In particular, a provider timer capped to the
	// deadline is processor control flow rather than a degradable timeout.
	assertProcessorActive(context, stage);
	if (error instanceof ProviderRequestError) return error;
	if (Object.hasOwn(PROVIDER_SAFE_MESSAGES, error?.providerFailureCode)) {
		return new ProviderRequestError(error.providerFailureCode, {
			cause: error,
			httpStatus: error.providerHttpStatus,
		});
	}
	throw error;
}

const PROVIDER_INPUT_FRAMING_TOKEN_UPPER_BOUND = 1_024;

/**
 * Conservative pre-dispatch upper bound: one token per UTF-8 byte of the exact
 * serialized HTTP request body, plus a fixed allowance for provider chat
 * framing. This intentionally does not claim exact tokenizer behavior.
 */
export function estimateProviderInputTokens({
	serializedRequestBody,
	messages,
	tools,
	toolChoice,
} = {}) {
	let serialized = serializedRequestBody;
	if (serialized === undefined) {
		try {
			// Retain the public helper's original input shape for existing callers.
			serialized = JSON.stringify({ messages, tools, tool_choice: toolChoice });
		} catch (error) {
			throw new TypeError("Provider request input must be JSON serializable.", {
				cause: error,
			});
		}
	}
	if (typeof serialized !== "string") {
		throw new TypeError("Provider request input must be JSON serializable.");
	}
	return (
		Buffer.byteLength(serialized, "utf8") +
		PROVIDER_INPUT_FRAMING_TOKEN_UPPER_BOUND
	);
}

/**
 * Processor-only OpenRouter boundary. Model, timeout, and reservation exposure
 * come exclusively from the pinned server-owned provider descriptor.
 */
export async function callOpenRouterForProcessor({
	apiKey,
	context,
	provider,
	nextProviderRequestId,
	kind,
	stage,
	messages,
	maxTokens = 12000,
	temperature,
	json = true,
	tools,
	toolChoice,
} = {}) {
	const descriptor = validateProviderDescriptor(context, provider);
	const metadata = requireRequestMetadata(kind, stage);
	if (!Array.isArray(messages)) {
		throw new TypeError("Provider request messages must be an array.");
	}
	if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
		throw new TypeError("Provider maxTokens must be a positive number.");
	}
	if (
		descriptor.supportsToolUse !== true &&
		(tools !== undefined || toolChoice !== undefined)
	) {
		throw new TypeError("The selected provider does not support tool use.");
	}
	const cappedMaxTokens = Math.min(
		maxTokens,
		descriptor.requestCeilings.maxOutputTokens,
	);
	let serializedRequestBody;
	try {
		// This is the sole read/serialization of mutable caller-owned request data.
		// It happens before request identity or ledger exposure is allocated.
		serializedRequestBody = serializeOpenRouterRequestBody(
			descriptor.modelId,
			messages,
			cappedMaxTokens,
			{
				temperature,
				json,
				tools,
				tool_choice: toolChoice,
			},
		);
	} catch (error) {
		throw new TypeError("Provider request input must be JSON serializable.", {
			cause: error,
		});
	}
	const estimatedInputTokens = estimateProviderInputTokens({
		serializedRequestBody,
	});
	if (estimatedInputTokens > descriptor.requestCeilings.maxInputTokens) {
		throw new ProviderInputLimitError();
	}
	if (
		descriptor.worstCaseReservation.inputTokens <
		descriptor.requestCeilings.maxInputTokens
	) {
		throw new TypeError("Provider input reservation is below its request ceiling.");
	}
	if (typeof nextProviderRequestId !== "function") {
		throw new TypeError("A processor-owned provider request-id factory is required.");
	}
	const requestId = nextProviderRequestId(metadata);
	if (typeof requestId !== "string" || !requestId.trim()) {
		throw new TypeError("Provider request-id factory returned an invalid id.");
	}
	if (!requestId.startsWith(`${context.identity.attemptId}:`)) {
		throw new TypeError("Provider request id is not bound to this attempt.");
	}

	try {
		return await executeProviderRequest({
			context,
			reservation: {
				requestId,
				kind: metadata.kind,
				worstCase: descriptor.worstCaseReservation,
			},
			configuredTimeoutMs: descriptor.requestTimeoutMs,
			stage: metadata.stage,
			dispatch: ({
				signal,
				timeoutMs,
				applicationDeadlineAt,
				absoluteJobDeadlineAt,
				effectiveDeadlineAt,
			}) =>
				callOpenRouterWithSerializedBody(apiKey, serializedRequestBody, {
					signal,
					timeoutMs,
					applicationDeadlineAt,
					absoluteJobDeadlineAt,
					effectiveDeadlineAt,
				}),
			getTrustedUsage: trustedOpenRouterUsage,
		});
	} catch (error) {
		throw classifyProviderError(error, context, metadata.stage);
	}
}

async function repairModelJson(
	apiKey,
	modelId,
	brokenText,
	shapeInstructions,
	options = {},
) {
	const repair = await callOpenRouter(
		apiKey,
		modelId,
		[
			{ role: "system", content: JSON_REPAIR_SYSTEM_PROMPT },
			{
				role: "user",
				content: buildJsonRepairUserPrompt(brokenText, shapeInstructions),
			},
		],
		8000,
		{ ...options, json: true },
	);
	return { ...repair, parsed: parseJsonObject(repair.text) };
}

export async function parseOrRepair(
	apiKey,
	modelId,
	text,
	shapeInstructions,
	options = {},
) {
	try {
		return { parsed: parseJsonObject(text), repaired: false };
	} catch (parseError) {
		const repaired = await repairModelJson(
			apiKey,
			modelId,
			text,
			shapeInstructions,
			options,
		);
		return {
			parsed: repaired.parsed,
			repaired: true,
			repairedText: repaired.text,
			repairData: repaired.data,
			parseError,
		};
	}
}

export async function parseOrRepairForProcessor({
	apiKey,
	context,
	provider,
	nextProviderRequestId,
	text,
	shapeInstructions,
	stage = "json-repair",
} = {}) {
	try {
		return { parsed: parseJsonObject(text), repaired: false };
	} catch (parseError) {
		const repair = await callOpenRouterForProcessor({
			apiKey,
			context,
			provider,
			nextProviderRequestId,
			kind: "json-repair",
			stage,
			messages: [
				{ role: "system", content: JSON_REPAIR_SYSTEM_PROMPT },
				{
					role: "user",
					content: buildJsonRepairUserPrompt(text, shapeInstructions),
				},
			],
			maxTokens: 8000,
			json: true,
		});
		let parsed;
		try {
			parsed = parseJsonObject(repair.text);
		} catch (error) {
			throw new ProviderRequestError(PROVIDER_FAILURE_CODES.RESPONSE, {
				cause: error,
			});
		}
		return {
			parsed,
			repaired: true,
			repairedText: repair.text,
			repairData: repair.data,
			parseError,
		};
	}
}

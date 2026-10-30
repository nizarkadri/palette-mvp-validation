import {
	SCREENSHOT_TO_CODE_STRICT_SYSTEM_PROMPT,
	TOOLLESS_SCREENSHOT_TO_CODE_INSTRUCTION,
	buildScreenshotGenerationRetryInstructions,
	buildScreenshotToCodeUserPrompt,
} from "../../src/prompts/index.js";
import {
	DEFAULT_VARIANT_COUNT,
	GEMINI_IMAGE_VARIANT_MODEL_ID,
	GEMINI_LITE_IMAGE_VARIANT_MODEL_ID,
} from "../constants.js";
import { finalizeGeneratedHtml, htmlFromRawModelText } from "../utils/html.js";
import { writeDebugJson, writeDebugText } from "../utils/debug.js";
import {
	PROVIDER_FAILURE_CODES,
	ProviderRequestError,
	callOpenRouter,
	callOpenRouterForProcessor,
} from "./openRouter.js";

/** A safe, explicitly degradable failure for structurally unusable HTML. */
export class GenerationOutputError extends Error {
	constructor({ cause } = {}) {
		super(
			"The model provider returned unusable generated HTML.",
			cause === undefined ? {} : { cause },
		);
		this.name = "GenerationOutputError";
		this.code = "GENERATION_OUTPUT_INVALID";
		this.safeMessage = this.message;
		this.retryable = false;
	}
}

const SCREENSHOT_TO_CODE_TOOLS = [
	{
		type: "function",
		function: {
			name: "create_file",
			description:
				"Create the main HTML file. Use exactly once with the full index.html content.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Use index.html." },
					content: { type: "string", description: "Full HTML content." },
				},
				required: ["content"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "edit_file",
			description:
				"Edit the current HTML file using exact string replacement. Prefer create_file for the first draft.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string" },
					old_text: { type: "string" },
					new_text: { type: "string" },
					count: { type: "integer" },
					edits: {
						type: "array",
						items: {
							type: "object",
							properties: {
								old_text: { type: "string" },
								new_text: { type: "string" },
								count: { type: "integer" },
							},
							required: ["old_text", "new_text"],
						},
					},
				},
			},
		},
	},
];

function processorBoundaryEnabled({
	context,
	provider,
	nextProviderRequestId,
} = {}) {
	const supplied = [context, provider, nextProviderRequestId].some(
		(value) => value !== undefined,
	);
	if (!supplied) return false;
	if (
		!context ||
		typeof context !== "object" ||
		!provider ||
		typeof provider !== "object" ||
		typeof nextProviderRequestId !== "function"
	) {
		throw new TypeError(
			"Context-aware generation requires context, provider, and nextProviderRequestId.",
		);
	}
	return true;
}

async function requestGenerationCompletion({
	apiKey,
	modelId,
	messages,
	maxTokens,
	options,
	context,
	provider,
	nextProviderRequestId,
	kind,
	stage,
}) {
	if (processorBoundaryEnabled({ context, provider, nextProviderRequestId })) {
		return callOpenRouterForProcessor({
			apiKey,
			context,
			provider,
			nextProviderRequestId,
			kind,
			stage,
			messages,
			maxTokens,
			temperature: options.temperature,
			json: options.json,
			tools: options.tools,
			toolChoice: options.tool_choice,
		});
	}
	return callOpenRouter(apiKey, modelId, messages, maxTokens, options);
}

function safeJsonParseArgs(raw) {
	try {
		return JSON.parse(raw || "{}");
	} catch {
		return {};
	}
}

function countTextOccurrences(content, searchText) {
	if (!searchText) return 0;
	let count = 0;
	let index = 0;
	while (true) {
		index = content.indexOf(searchText, index);
		if (index === -1) return count;
		count += 1;
		index += searchText.length;
	}
}

function applyTextEdit(content, oldText, newText, count = 1) {
	const replacement = newText || "";
	if (!oldText) {
		return {
			content,
			appliedCount: 0,
			missingOldText: true,
			warning: "edit_file was called without old_text.",
		};
	}

	const availableCount = countTextOccurrences(content, oldText);
	if (availableCount === 0) {
		return {
			content,
			appliedCount: 0,
			missingOldText: true,
			warning: "edit_file old_text was not found in the current HTML.",
		};
	}

	if (count === -1) {
		return {
			content: content.split(oldText).join(replacement),
			appliedCount: availableCount,
			missingOldText: false,
		};
	}

	const requestedCount = Math.max(1, Number.parseInt(count, 10) || 1);
	const appliedCount = Math.min(requestedCount, availableCount);
	let next = content;
	for (let i = 0; i < appliedCount; i += 1) {
		next = next.replace(oldText, replacement);
	}
	return {
		content: next,
		appliedCount,
		missingOldText: false,
	};
}

export async function runHtmlToolAgent({
	apiKey,
	modelId,
	messages,
	initialHtml = "",
	maxTurns = 6,
	temperature,
	context,
	provider,
	nextProviderRequestId,
	initialRequestKind = "generation",
	stagePrefix = "html-tool-agent",
}) {
	let currentHtml = initialHtml;
	let lastData = null;
	const toolEvents = [];

	for (let turn = 0; turn < maxTurns; turn += 1) {
		const completion = await requestGenerationCompletion({
			apiKey,
			modelId,
			messages,
			maxTokens: 16000,
			options: {
				json: false,
				tools: SCREENSHOT_TO_CODE_TOOLS,
				temperature,
			},
			context,
			provider,
			nextProviderRequestId,
			kind: turn === 0 ? initialRequestKind : "tool-turn",
			stage: `${stagePrefix}-${turn + 1}`,
		});
		lastData = completion.data;
		const message = completion.data?.choices?.[0]?.message;
		const toolCalls = message?.tool_calls || [];

		if (toolCalls.length === 0) {
			const rawHtml = htmlFromRawModelText(completion.text);
			return {
				html: rawHtml || currentHtml,
				data: lastData,
				toolEvents,
			};
		}

		messages.push(message);
		for (const toolCall of toolCalls) {
			const name = toolCall.function?.name;
			const args = safeJsonParseArgs(toolCall.function?.arguments);
			if (name === "create_file") {
				currentHtml = String(args.content || "");
				toolEvents.push({ name, path: args.path || "index.html" });
				messages.push({
					role: "tool",
					tool_call_id: toolCall.id,
					content: "Created index.html successfully.",
				});
			} else if (name === "edit_file") {
				const rawEdits = Array.isArray(args.edits)
					? args.edits
					: [
							{
								old_text: args.old_text,
								new_text: args.new_text,
								count: args.count,
							},
						];
				const editResults = rawEdits.map((edit, index) => {
					const result = applyTextEdit(
						currentHtml,
						edit.old_text,
						edit.new_text,
						edit.count,
					);
					currentHtml = result.content;
					if (result.warning) {
						console.warn(
							`[screenshot-tool-agent] ${result.warning} index=${index} preview=${JSON.stringify(
								String(edit.old_text || "").slice(0, 120),
							)}`,
						);
					}
					return {
						index,
						appliedCount: result.appliedCount,
						missingOldText: result.missingOldText,
						warning: result.warning,
						oldTextPreview: String(edit.old_text || "").slice(0, 120),
					};
				});
				const appliedCount = editResults.reduce(
					(total, result) => total + result.appliedCount,
					0,
				);
				const missingCount = editResults.filter(
					(result) => result.missingOldText,
				).length;
				toolEvents.push({
					name,
					path: args.path || "index.html",
					appliedCount,
					missingOldText: missingCount,
					edits: editResults,
				});
				messages.push({
					role: "tool",
					tool_call_id: toolCall.id,
					content:
						missingCount > 0
							? `Edited index.html with warnings: ${appliedCount} replacement(s) applied; ${missingCount} old_text value(s) were not found.`
							: `Edited index.html successfully: ${appliedCount} replacement(s) applied.`,
				});
			} else {
				messages.push({
					role: "tool",
					tool_call_id: toolCall.id,
					content: `Tool ${name} is not available in this local MVP.`,
				});
			}
		}
	}

	return { html: currentHtml, data: lastData, toolEvents };
}

export function modelSupportsToolUse(modelId) {
	return !/gemini-3\.1-flash(?:-lite)?-image/i.test(modelId);
}

function screenshotGenerationMessages(
	base64,
	mediaType,
	extraInstructions = "",
) {
	return [
		{ role: "system", content: SCREENSHOT_TO_CODE_STRICT_SYSTEM_PROMPT },
		{
			role: "user",
			content: [
				{
					type: "image_url",
					image_url: {
						url: `data:${mediaType};base64,${base64}`,
						detail: "high",
					},
				},
				{
					type: "text",
					text: buildScreenshotToCodeUserPrompt(extraInstructions),
				},
			],
		},
	];
}

async function runTextOnlyScreenshotToCodeAgent(
	apiKey,
	modelId,
	base64,
	mediaType,
	extraInstructions = "",
	options = {},
) {
	const messages = screenshotGenerationMessages(
		base64,
		mediaType,
		`${extraInstructions}\n\n${TOOLLESS_SCREENSHOT_TO_CODE_INSTRUCTION}`,
	);
	const completion = await requestGenerationCompletion({
		apiKey,
		modelId,
		messages,
		maxTokens: 16000,
		options: { json: false, temperature: options.temperature },
		context: options.context,
		provider: options.provider,
		nextProviderRequestId: options.nextProviderRequestId,
		kind: options.requestKind || "generation",
		stage: options.stage || "text-only-generation",
	});
	const html = htmlFromRawModelText(completion.text);
	if (!html) {
		throw new ProviderRequestError(PROVIDER_FAILURE_CODES.RESPONSE, {
			cause: new Error("Text-only generation returned no parseable HTML."),
		});
	}
	return { html, data: completion.data, toolEvents: [] };
}

async function runScreenshotToCodeAgent(
	apiKey,
	modelId,
	base64,
	mediaType,
	extraInstructions = "",
	options = {},
) {
	const supportsToolUse = processorBoundaryEnabled(options)
		? options.provider.supportsToolUse
		: modelSupportsToolUse(modelId);
	if (!supportsToolUse) {
		return runTextOnlyScreenshotToCodeAgent(
			apiKey,
			modelId,
			base64,
			mediaType,
			extraInstructions,
			options,
		);
	}

	return runHtmlToolAgent({
		apiKey,
		modelId,
		messages: screenshotGenerationMessages(
			base64,
			mediaType,
			extraInstructions,
		),
		temperature: options.temperature,
		context: options.context,
		provider: options.provider,
		nextProviderRequestId: options.nextProviderRequestId,
		initialRequestKind: options.requestKind || "generation",
		stagePrefix: options.stage || "screenshot-generation",
	});
}

function hasVisibleBodyContent(html) {
	const bodyMatch = String(html || "").match(
		/<body\b[^>]*>([\s\S]*?)<\/body>/i,
	);
	if (!bodyMatch) return true;
	const visibleBody = bodyMatch[1]
		.replace(/<style\b[\s\S]*?<\/style>/gi, "")
		.replace(/<script\b[\s\S]*?<\/script>/gi, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<[^>]+>/g, "")
		.trim();
	return (
		visibleBody.length > 0 ||
		/<(?:div|main|section|article|nav|header|footer|svg|img|button|a)\b/i.test(
			bodyMatch[1],
		)
	);
}

function hasFatalGenerationIssue(issues) {
	return issues.includes("has no visible body content");
}

export function generationIssues(html) {
	const issues = [];
	if (!hasVisibleBodyContent(html)) issues.push("has no visible body content");
	if (/<i\b/i.test(html)) issues.push("uses <i> placeholder/icon tags");
	if (
		/font-awesome|fontawesome|fa-|tabler|ti-|ion-icon|ionicons|bootstrap-icons/i.test(
			html,
		)
	) {
		issues.push("uses an icon library instead of inline SVG/CSS icons");
	}
	if (
		/phone-frame|device-frame|dynamic-island|status-bar|iphone|mockup|notch|island/i.test(
			html,
		)
	) {
		issues.push("adds a device/mobile frame, notch, or generic status chrome");
	}
	if (/🚀|🏠|🔍|💬|🔔|❤️|💜|🧰|📋|🗂|🔧|⚙️|🌈/.test(html)) {
		issues.push(
			"uses emoji/colorful icons instead of screenshot-matched SVG icons",
		);
	}
	if (
		/overflow-y\s*:\s*(?:auto|scroll)|overflow\s*:\s*(?:auto|scroll)/i.test(
			html,
		)
	) {
		issues.push("adds internal scrolling instead of fitting the first screen");
	}
	return issues;
}

function parseVariantCount(env) {
	const configured = env.OPENROUTER_VARIANT_COUNT;
	if (configured === undefined || configured === "") {
		return DEFAULT_VARIANT_COUNT;
	}

	const count = Number(configured);
	if (!Number.isInteger(count) || count !== DEFAULT_VARIANT_COUNT) {
		throw new TypeError("OPENROUTER_VARIANT_COUNT must be exactly 3.");
	}
	return count;
}

export function variantModelIds(env, primaryModelId) {
	const count = parseVariantCount(env);
	const configured = String(env.OPENROUTER_VARIANT_MODELS || "")
		.split(",")
		.map((model) => model.trim())
		.filter(Boolean);
	const secondary = env.OPENROUTER_SECONDARY_MODEL_ID?.trim();
	const candidates = configured.length
		? configured
		: [
				primaryModelId,
				secondary || GEMINI_IMAGE_VARIANT_MODEL_ID,
				GEMINI_LITE_IMAGE_VARIANT_MODEL_ID,
			];

	while (candidates.length < count) candidates.push(primaryModelId);
	return candidates.slice(0, count);
}

export async function generateCandidate({
	apiKey,
	modelId,
	base64,
	mediaType,
	session,
	variantIndex,
	context,
	provider,
	nextProviderRequestId,
}) {
	const debugPrefix = `variant-${variantIndex + 1}`;
	const useProcessorBoundary = processorBoundaryEnabled({
		context,
		provider,
		nextProviderRequestId,
	});
	const executionModelId = useProcessorBoundary ? provider.modelId : modelId;
	let generation = await runScreenshotToCodeAgent(
		apiKey,
		executionModelId,
		base64,
		mediaType,
		"",
		{
			temperature: 0.15 + variantIndex * 0.15,
			context,
			provider,
			nextProviderRequestId,
			requestKind: "generation",
			stage: `${debugPrefix}-generation`,
		},
	);
	let html = finalizeGeneratedHtml({ html: generation.html });
	let issues = generationIssues(html);

	if (issues.length > 0) {
		await writeDebugJson(
			session,
			`${debugPrefix}-generation-issues.json`,
			issues,
		);
		generation = await runScreenshotToCodeAgent(
			apiKey,
			executionModelId,
			base64,
			mediaType,
			buildScreenshotGenerationRetryInstructions(issues),
			{
				temperature: 0.1,
				context,
				provider,
				nextProviderRequestId,
				requestKind: "regeneration",
				stage: `${debugPrefix}-regeneration`,
			},
		);
		html = finalizeGeneratedHtml({ html: generation.html });
		issues = generationIssues(html);
		await writeDebugJson(
			session,
			`${debugPrefix}-generation-retry-issues.json`,
			issues,
		);
	}

	if (hasFatalGenerationIssue(issues)) {
		throw new GenerationOutputError({
			cause: new Error(`Generated HTML is unusable: ${issues.join(", ")}.`),
		});
	}

	await writeDebugJson(session, `${debugPrefix}-generation-response.json`, {
		modelId: executionModelId,
		response: generation.data,
	});
	await writeDebugJson(
		session,
		`${debugPrefix}-generation-tool-events.json`,
		generation.toolEvents,
	);
	await writeDebugText(session, `${debugPrefix}-generated.html`, html);

	return {
		variantIndex,
		modelId: executionModelId,
		generation,
		html,
		issues,
		renderedScreenshot: null,
		visualEvaluation: null,
	};
}

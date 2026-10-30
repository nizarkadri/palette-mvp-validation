import {
	SEMANTIC_CATEGORIZATION_PROMPT,
	SEMANTIC_CATEGORIZATION_SHAPE,
	buildSemanticCategorizationUserText,
} from "../../src/prompts/index.js";
import { rethrowIfProcessorControlFlow } from "../shared/errors.js";
import { sanitizeGeneratedHtml } from "../utils/html.js";
import { finalizeSemanticElements } from "../utils/elements.js";
import { writeDebugJson, writeDebugText } from "../utils/debug.js";
import {
	callOpenRouter,
	ProviderRequestError,
	callOpenRouterForProcessor,
	parseOrRepair,
	parseOrRepairForProcessor,
} from "./openRouter.js";

export async function categorizeHtmlForPalette({
	apiKey,
	modelId,
	html,
	base64,
	mediaType,
	session,
	debugPrefix = "semantic",
	context,
	provider,
	nextProviderRequestId,
}) {
	const safeHtml = sanitizeGeneratedHtml(html);
	let elements;
	let semanticDebug = {};
	const boundaryRequested = [context, provider, nextProviderRequestId].some(
		(value) => value !== undefined,
	);
	if (
		boundaryRequested &&
		(!context ||
			typeof context !== "object" ||
			!provider ||
			typeof provider !== "object" ||
			typeof nextProviderRequestId !== "function")
	) {
		throw new TypeError(
			"Context-aware categorization requires context, provider, and nextProviderRequestId.",
		);
	}
	const useProcessorBoundary = boundaryRequested;

	try {
		const messages = [
			{ role: "system", content: SEMANTIC_CATEGORIZATION_PROMPT },
			{
				role: "user",
				content: [
					{
						type: "text",
						text: buildSemanticCategorizationUserText(safeHtml),
					},
					{
						type: "image_url",
						image_url: { url: `data:${mediaType};base64,${base64}` },
					},
				],
			},
		];
		const semantic = useProcessorBoundary
			? await callOpenRouterForProcessor({
					apiKey,
					context,
					provider,
					nextProviderRequestId,
					kind: "categorization",
					stage: `${debugPrefix}-request`,
					messages,
				})
			: await callOpenRouter(apiKey, modelId, messages);
		await writeDebugText(session, `${debugPrefix}-output.txt`, semantic.text);
		await writeDebugJson(
			session,
			`${debugPrefix}-response.json`,
			semantic.data,
		);
		const semanticParse = useProcessorBoundary
			? await parseOrRepairForProcessor({
					apiKey,
					context,
					provider,
					nextProviderRequestId,
					text: semantic.text,
					shapeInstructions: SEMANTIC_CATEGORIZATION_SHAPE,
					stage: `${debugPrefix}-json-repair`,
				})
			: await parseOrRepair(
					apiKey,
					modelId,
					semantic.text,
					SEMANTIC_CATEGORIZATION_SHAPE,
				);
		if (semanticParse.repaired) {
			await writeDebugText(
				session,
				`${debugPrefix}-repaired-output.txt`,
				semanticParse.repairedText,
			);
			await writeDebugJson(
				session,
				`${debugPrefix}-repair-response.json`,
				semanticParse.repairData,
			);
		}
		elements = finalizeSemanticElements(semanticParse.parsed, safeHtml);
		semanticDebug = { semanticFallback: false };
	} catch (semanticError) {
		rethrowIfProcessorControlFlow(semanticError);
		if (
			useProcessorBoundary &&
			!(semanticError instanceof ProviderRequestError)
		) {
			throw semanticError;
		}
		await writeDebugJson(session, `${debugPrefix}-error.json`, {
			message: semanticError.message,
		});
		elements = finalizeSemanticElements({ elements: [] }, safeHtml);
		semanticDebug = {
			semanticFallback: true,
			semanticError: semanticError.message,
		};
	}

	return { html: safeHtml, elements, semanticDebug };
}

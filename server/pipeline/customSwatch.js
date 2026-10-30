import {
	callOpenRouterForProcessor,
	parseOrRepairForProcessor,
} from "../services/openRouter.js";
import {
	assertProcessorContextForJobKind,
	awaitProcessorBoundary,
	contextExecutionOptions,
	createCanonicalArtifact,
	createProcessorRequestIdFactory,
	requireDependencies,
	requireNonEmptyString,
	requireOptionalNonEmptyString,
	requirePlainInput,
	serviceDependency,
} from "./artifacts.js";

const ALLOWED_INTENTS = new Set([
	"choice",
	"badge",
	"button",
	"control",
	"surface",
	"icon",
	"text",
	"default",
]);

const ALLOWED_APPLICATION_MODES = new Set([
	"softTintWithBorder",
	"softTint",
	"surfaceWithBorder",
	"solidFill",
	"iconOnly",
	"textOnly",
	"smartDefault",
]);

const CUSTOM_SWATCH_VISUAL_SHAPE = `Return JSON only:
{
  "intent": "choice|badge|button|control|surface|icon|text|default",
  "applicationMode": "softTintWithBorder|softTint|surfaceWithBorder|solidFill|iconOnly|textOnly|smartDefault",
  "confidence": 0.0,
  "rationale": "short reason"
}`;

function requirePlainNestedObject(value, name) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	return value;
}

function validateInput(input) {
	requirePlainInput(input, "custom swatch input");
	if (Object.hasOwn(input, "modelId")) {
		throw new TypeError("Custom swatch processor input must not contain a model id.");
	}
	const swatch = input.swatch ?? {};
	const elements = input.elements ?? [];
	const palette = input.palette ?? {};
	requirePlainNestedObject(swatch, "custom swatch input.swatch");
	requirePlainNestedObject(palette, "custom swatch input.palette");
	if (!Array.isArray(elements)) {
		throw new TypeError("custom swatch input.elements must be an array.");
	}
	return {
		base64: requireNonEmptyString(input.base64, "custom swatch input.base64"),
		mediaType: requireOptionalNonEmptyString(
			input.mediaType,
			"image/png",
			"custom swatch input.mediaType",
		),
		swatch,
		elements,
		palette,
	};
}

function buildCustomSwatchVisualPrompt({ swatch, elements, palette }) {
	return `Analyze the selected UI screenshot and decide how this custom palette swatch should behave visually.

The user added a swatch named "${swatch?.label || "Custom"}" and assigned these elements to it:
${JSON.stringify(elements || [], null, 2)}

Current palette:
${JSON.stringify(palette || {}, null, 2)}

Choose the best semantic intent and application mode. Important guidance:
- Poll options / selectable choices should usually be intent "choice" and mode "softTintWithBorder".
- Chips/badges/status pills should usually be "badge" and "softTint".
- Primary/CTA-like actions should be "button" and "solidFill".
- Inputs, tabs, segmented controls, selectors should usually be "control" and "surfaceWithBorder".
- Cards/containers should usually be "surface" and "surfaceWithBorder".
- Icons only should be "icon" and "iconOnly".
- Text-only groups should be "text" and "textOnly".
- Avoid harsh fills for option rows/cards unless they are clearly buttons.

${CUSTOM_SWATCH_VISUAL_SHAPE}`;
}

function normalizeVisualResult(result = {}) {
	const intent = ALLOWED_INTENTS.has(result.intent) ? result.intent : "default";
	const applicationMode = ALLOWED_APPLICATION_MODES.has(result.applicationMode)
		? result.applicationMode
		: intent === "choice"
			? "softTintWithBorder"
			: "smartDefault";
	return Object.freeze({
		intent,
		applicationMode,
		confidence:
			typeof result.confidence === "number" && Number.isFinite(result.confidence)
				? Math.max(0, Math.min(1, result.confidence))
				: 0,
		rationale:
			typeof result.rationale === "string"
				? result.rationale.slice(0, 240)
				: "",
	});
}

/** HTTP-independent custom-swatch prompt/provider/repair processor. */
export async function processCustomSwatchAnalysis(input, context, dependencies) {
	const validatedInput = validateInput(input);
	assertProcessorContextForJobKind(context, "custom-swatch");
	const provider = context.modelProfile.provider;
	if (!provider) {
		throw new TypeError("Custom swatch model profile must own a provider.");
	}
	const { dependencies: runtime, apiKey } = requireDependencies(dependencies);
	const nextProviderRequestId = createProcessorRequestIdFactory(
		context,
		runtime,
		"custom-swatch",
	);
	const request = serviceDependency(
		runtime,
		"callOpenRouterForProcessor",
		callOpenRouterForProcessor,
	);
	const parse = serviceDependency(
		runtime,
		"parseOrRepairForProcessor",
		parseOrRepairForProcessor,
	);
	const execution = contextExecutionOptions(
		context,
		provider,
		nextProviderRequestId,
	);
	const visual = await awaitProcessorBoundary(
		context,
		"custom-swatch-provider",
		() =>
			request({
				apiKey,
				...execution,
				kind: "custom-swatch",
				stage: "custom-swatch-analysis",
				messages: [
					{
						role: "system",
						content:
							"You are a senior product UI color designer. Return strict JSON only.",
					},
					{
						role: "user",
						content: [
							{
								type: "text",
								text: buildCustomSwatchVisualPrompt(validatedInput),
							},
							{
								type: "image_url",
								image_url: {
									url: `data:${validatedInput.mediaType};base64,${validatedInput.base64}`,
								},
							},
						],
					},
				],
				maxTokens: 1600,
				temperature: 0.2,
			}),
	);
	if (!visual || typeof visual.text !== "string") {
		throw new TypeError("Custom swatch provider returned an invalid result.");
	}
	const parsed = await awaitProcessorBoundary(
		context,
		"custom-swatch-json-repair",
		() =>
			parse({
				apiKey,
				...execution,
				text: visual.text,
				shapeInstructions: CUSTOM_SWATCH_VISUAL_SHAPE,
				stage: "custom-swatch-json-repair",
			}),
	);
	const result = normalizeVisualResult(parsed?.parsed);
	await createCanonicalArtifact(context, {
		logicalKey: "custom-swatch-result",
		kind: "result",
		value: result,
	});
	return result;
}

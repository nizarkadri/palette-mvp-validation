import { categorizeHtmlForPalette } from "../services/categorization.js";
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

function validateInput(input) {
	requirePlainInput(input, "categorization input");
	return {
		html: requireNonEmptyString(input.html, "categorization input.html"),
		base64: requireNonEmptyString(input.base64, "categorization input.base64"),
		mediaType: requireOptionalNonEmptyString(
			input.mediaType,
			"image/png",
			"categorization input.mediaType",
		),
	};
}

/** HTTP-independent semantic categorization processor. */
export async function processCategorization(input, context, dependencies) {
	const validatedInput = validateInput(input);
	assertProcessorContextForJobKind(context, "categorization");
	const provider = context.modelProfile.provider;
	if (!provider) {
		throw new TypeError("Categorization model profile must own a provider.");
	}
	const { dependencies: runtime, apiKey } = requireDependencies(dependencies);
	const nextProviderRequestId = createProcessorRequestIdFactory(
		context,
		runtime,
		"categorization",
	);
	const categorize = serviceDependency(
		runtime,
		"categorizeHtmlForPalette",
		categorizeHtmlForPalette,
	);
	const categorized = await awaitProcessorBoundary(
		context,
		"categorization-service",
		() =>
			categorize({
				apiKey,
				...validatedInput,
				...contextExecutionOptions(context, provider, nextProviderRequestId),
			}),
	);
	if (
		!categorized ||
		typeof categorized.html !== "string" ||
		!Array.isArray(categorized.elements)
	) {
		throw new TypeError("Categorization service returned an invalid result.");
	}
	const result = Object.freeze({
		html: categorized.html,
		elements: categorized.elements,
	});

	await createCanonicalArtifact(context, {
		logicalKey: "categorized-html",
		kind: "html",
		value: { html: result.html },
	});
	await createCanonicalArtifact(context, {
		logicalKey: "categorized-elements",
		kind: "elements",
		value: result.elements,
	});
	await createCanonicalArtifact(context, {
		logicalKey: "categorization-result",
		kind: "result",
		value: result,
	});
	return result;
}

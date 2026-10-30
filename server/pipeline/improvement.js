import {
	DegradableRenderError,
	correctCandidateWithVisualFeedback,
	publicVariant,
	renderAndEvaluateCandidate,
} from "../services/visualVerifier.js";
import {
	assertProcessorContextForJobKind,
	awaitProcessorBoundary,
	canonicalScreenshot,
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
	requirePlainInput(input, "improvement input");
	if (Object.hasOwn(input, "modelId")) {
		throw new TypeError("Improvement processor input must not contain a model id.");
	}
	return {
		html: requireNonEmptyString(input.html, "improvement input.html"),
		base64: requireNonEmptyString(input.base64, "improvement input.base64"),
		mediaType: requireOptionalNonEmptyString(
			input.mediaType,
			"image/png",
			"improvement input.mediaType",
		),
	};
}

/** HTTP-independent render/evaluate/correct/render improvement processor. */
export async function processImprovement(input, context, dependencies) {
	const validatedInput = validateInput(input);
	assertProcessorContextForJobKind(context, "improvement");
	const provider = context.modelProfile.provider;
	if (!provider) {
		throw new TypeError("Improvement model profile must own a provider.");
	}
	const { dependencies: runtime, apiKey } = requireDependencies(dependencies);
	const nextProviderRequestId = createProcessorRequestIdFactory(
		context,
		runtime,
		"improvement",
	);
	const render = serviceDependency(
		runtime,
		"renderAndEvaluateCandidate",
		renderAndEvaluateCandidate,
	);
	const correct = serviceDependency(
		runtime,
		"correctCandidateWithVisualFeedback",
		correctCandidateWithVisualFeedback,
	);
	const toPublicVariant = serviceDependency(
		runtime,
		"publicVariant",
		publicVariant,
	);
	const execution = contextExecutionOptions(
		context,
		provider,
		nextProviderRequestId,
	);

	await createCanonicalArtifact(context, {
		logicalKey: "source-html",
		kind: "html",
		value: { html: validatedInput.html },
	});
	let source = {
		variantIndex: 0,
		modelId: provider.modelId,
		generation: null,
		html: validatedInput.html,
		issues: [],
		renderedScreenshot: null,
		visualEvaluation: null,
	};
	source = await awaitProcessorBoundary(
		context,
		"improvement-source-render",
		() =>
			render({
				apiKey,
				...validatedInput,
				candidate: source,
				debugPrefix: "source",
				...execution,
			}),
	);
	const sourceScreenshot = canonicalScreenshot(source?.renderedScreenshot);
	if (!sourceScreenshot) throw new DegradableRenderError();
	await createCanonicalArtifact(context, {
		logicalKey: "source-screenshot",
		kind: "screenshot",
		value: sourceScreenshot,
	});
	await createCanonicalArtifact(context, {
		logicalKey: "source-evaluation",
		kind: "evaluation",
		value: source.visualEvaluation,
	});

	let improved = await awaitProcessorBoundary(
		context,
		"improvement-correction",
		() =>
			correct({
				apiKey,
				...validatedInput,
				candidate: source,
				debugPrefix: "improvement",
				correctionKind: "visual",
				...execution,
			}),
	);
	await createCanonicalArtifact(context, {
		logicalKey: "improved-html",
		kind: "html",
		value: { html: improved.html },
	});
	improved = await awaitProcessorBoundary(
		context,
		"improvement-result-render",
		() =>
			render({
				apiKey,
				...validatedInput,
				candidate: improved,
				debugPrefix: "improved",
				evaluateVisual: false,
				...execution,
			}),
	);
	const improvedScreenshot = canonicalScreenshot(improved?.renderedScreenshot);
	if (!improvedScreenshot) throw new DegradableRenderError();
	await createCanonicalArtifact(context, {
		logicalKey: "improved-screenshot",
		kind: "screenshot",
		value: improvedScreenshot,
	});
	const result = Object.freeze({
		...toPublicVariant(improved),
		frameFit: improved.renderedScreenshot?.fitDiagnostics || null,
	});
	await createCanonicalArtifact(context, {
		logicalKey: "improvement-result",
		kind: "result",
		value: result,
	});
	return result;
}

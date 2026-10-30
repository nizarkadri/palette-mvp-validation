import { ProviderRequestError } from "../services/openRouter.js";
import {
	GenerationOutputError,
	generateCandidate,
} from "../services/screenshotGenerator.js";
import {
	DegradableRenderError,
	correctFrameFitIfNeeded,
	evaluateRenderedCandidate,
	publicVariant,
	renderAndEvaluateCandidate,
	scoreVariant,
} from "../services/visualVerifier.js";
import {
	CONTROL_FLOW_CODES,
	isProcessorControlFlowError,
	rethrowIfProcessorControlFlow,
} from "../shared/errors.js";
import { createContextProcessorEventStream } from "./events.js";
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

const VARIANT_COUNT = 3;
const MAX_COMPACT_ARTIFACT_BYTES = 64 * 1024;
const CONTROL_FLOW_PRIORITY = Object.freeze([
	CONTROL_FLOW_CODES.SHUTDOWN,
	CONTROL_FLOW_CODES.FENCE_LOST,
	CONTROL_FLOW_CODES.LEASE_LOST,
	CONTROL_FLOW_CODES.BUDGET_EXCEEDED,
	CONTROL_FLOW_CODES.DEADLINE_EXCEEDED,
	CONTROL_FLOW_CODES.CANCELLED,
]);

function validateInput(input) {
	requirePlainInput(input, "analysis input");
	return {
		base64: requireNonEmptyString(input.base64, "analysis input.base64"),
		mediaType: requireOptionalNonEmptyString(
			input.mediaType,
			"image/png",
			"analysis input.mediaType",
		),
	};
}

function validateAnalysisProfile(context) {
	const variants = context.modelProfile.variants;
	if (
		!Array.isArray(variants) ||
		variants.length !== VARIANT_COUNT ||
		variants.some(
			(variant, index) =>
				variant?.jobKind !== "analysis" ||
				variant.variantIndex !== index ||
				!variant.provider,
		)
	) {
		throw new TypeError(
			"Analysis model profile must own exactly the canonical variants 0, 1, and 2.",
		);
	}
	return variants;
}

function isDegradableFailure(error) {
	return (
		error instanceof ProviderRequestError ||
		error instanceof GenerationOutputError ||
		error instanceof DegradableRenderError
	);
}

function failureCode(error) {
	if (error instanceof ProviderRequestError) return error.code;
	if (error instanceof GenerationOutputError) return error.code;
	if (error instanceof DegradableRenderError) return error.code;
	return "PROCESSING_FAILED";
}

function failedOutcome(index, stage, error) {
	return Object.freeze({
		index,
		status: "failed",
		stage,
		code: failureCode(error),
		retryable: error.retryable === true,
		safeMessage:
			stage === "generation"
				? "Variant generation failed."
				: "Variant evaluation failed.",
	});
}

function completeOutcome(index, variant) {
	return Object.freeze({ index, status: "complete", variant });
}

function compactOutcomes(outcomes) {
	return outcomes.map((outcome) => ({
		index: outcome.index,
		status: outcome.status,
		...(outcome.status === "failed"
			? {
					stage: outcome.stage,
					code: outcome.code,
					retryable: outcome.retryable,
				}
			: {
					artifactReferences: {
						html: `variant-${outcome.index}-html`,
						screenshot: `variant-${outcome.index}-screenshot`,
						evaluation: `variant-${outcome.index}-evaluation`,
					},
				}),
	}));
}

function assertCompactArtifact(value, logicalKey) {
	const serializedBytes = Buffer.byteLength(JSON.stringify(value), "utf8");
	if (serializedBytes > MAX_COMPACT_ARTIFACT_BYTES) {
		throw new Error(`${logicalKey} exceeds the 64 KiB publication limit.`);
	}
	return value;
}

function selectControlFlowError(rejections) {
	const controls = rejections.filter(({ error }) =>
		isProcessorControlFlowError(error),
	);
	if (controls.length === 0) return null;
	return controls.sort((left, right) => {
		const priorityDelta =
			CONTROL_FLOW_PRIORITY.indexOf(left.error.code) -
			CONTROL_FLOW_PRIORITY.indexOf(right.error.code);
		return priorityDelta || left.index - right.index;
	})[0].error;
}

async function recordSafeFailure(context, variantIndex, stage, error) {
	try {
		await awaitProcessorBoundary(context, `diagnostics-${stage}`, () =>
			context.diagnostics.record({
				severity: "warn",
				stage,
				code:
					error instanceof ProviderRequestError ||
					error instanceof GenerationOutputError
						? "PROVIDER_FAILED"
						: "RENDER_FAILED",
				variantIndex,
				error,
			}),
		);
	} catch (error) {
		rethrowIfProcessorControlFlow(error);
		try {
			context.logger.warn("Processor diagnostics failed.", {
				code: "DIAGNOSTICS_FAILED",
			});
		} catch {
			// Diagnostics and logging are secondary to canonical processor results.
		}
	}
}

function stableBestCandidate(candidates, scoreCandidate) {
	return candidates.slice().sort((left, right) => {
		const scoreDelta = scoreCandidate(right) - scoreCandidate(left);
		if (Number.isFinite(scoreDelta) && Math.abs(scoreDelta) > 0.001) {
			return scoreDelta;
		}
		const issueDelta = (left.issues?.length || 0) - (right.issues?.length || 0);
		return issueDelta || left.variantIndex - right.variantIndex;
	})[0];
}

/**
 * Runs screenshot analysis without an HTTP or debug-filesystem dependency.
 * @param {object} input Validated job input shape.
 * @param {object} context Mandatory immutable processor context.
 * @param {object} dependencies Explicit runtime dependencies (at minimum apiKey).
 */
export async function processAnalysis(input, context, dependencies) {
	const validatedInput = validateInput(input);
	assertProcessorContextForJobKind(context, "analysis");
	const variants = validateAnalysisProfile(context);
	const { dependencies: runtime, apiKey } = requireDependencies(dependencies);
	const nextProviderRequestId = createProcessorRequestIdFactory(
		context,
		runtime,
		"analysis",
	);
	const generate = serviceDependency(
		runtime,
		"generateCandidate",
		generateCandidate,
	);
	const render = serviceDependency(
		runtime,
		"renderAndEvaluateCandidate",
		renderAndEvaluateCandidate,
	);
	const correctFrame = serviceDependency(
		runtime,
		"correctFrameFitIfNeeded",
		correctFrameFitIfNeeded,
	);
	const evaluate = serviceDependency(
		runtime,
		"evaluateRenderedCandidate",
		evaluateRenderedCandidate,
	);
	const toPublicVariant = serviceDependency(
		runtime,
		"publicVariant",
		publicVariant,
	);
	const scoreCandidate = serviceDependency(
		runtime,
		"scoreVariant",
		scoreVariant,
	);
	const { stream } = createContextProcessorEventStream(context, {
		variantCount: VARIANT_COUNT,
	});
	const artifactKeys = [];

	async function createArtifact(artifact) {
		await createCanonicalArtifact(context, artifact);
		artifactKeys.push(artifact.logicalKey);
	}

	async function processVariant(variantProfile, index) {
		const execution = contextExecutionOptions(
			context,
			variantProfile.provider,
			nextProviderRequestId,
		);
		let stage = "generation";
		try {
			let candidate = await awaitProcessorBoundary(
				context,
				`analysis-variant-${index}-generation`,
				() =>
					generate({
						apiKey,
						...validatedInput,
						variantIndex: index,
						...execution,
					}),
			);
			if (candidate?.variantIndex !== index) {
				throw new TypeError(
					"Generation returned a non-canonical variant index.",
				);
			}
			candidate = await awaitProcessorBoundary(
				context,
				`analysis-variant-${index}-render`,
				() =>
					render({
						apiKey,
						...validatedInput,
						candidate,
						debugPrefix: `variant-${index + 1}`,
						evaluateVisual: false,
						...execution,
					}),
			);
			candidate = await awaitProcessorBoundary(
				context,
				`analysis-variant-${index}-frame-fit`,
				() =>
					correctFrame({
						apiKey,
						...validatedInput,
						candidate,
						debugPrefix: `variant-${index + 1}`,
						...execution,
					}),
			);
			const screenshot = canonicalScreenshot(candidate?.renderedScreenshot);
			if (!screenshot) throw new DegradableRenderError();
			await createArtifact({
				logicalKey: `variant-${index}-html`,
				kind: "html",
				value: { html: candidate.html },
				metadata: { variantIndex: index },
			});
			await createArtifact({
				logicalKey: `variant-${index}-screenshot`,
				kind: "screenshot",
				value: screenshot,
				metadata: { variantIndex: index },
			});
			await stream.generation({
				variantIndex: index,
				output: toPublicVariant(candidate),
			});

			stage = "evaluation";
			candidate = await awaitProcessorBoundary(
				context,
				`analysis-variant-${index}-evaluation`,
				() =>
					evaluate({
						apiKey,
						...validatedInput,
						candidate,
						debugPrefix: `variant-${index + 1}`,
						strictProviderErrors: true,
						...execution,
					}),
			);
			if (!candidate?.visualEvaluation) {
				throw new ProviderRequestError("PROVIDER_RESPONSE_ERROR");
			}
			await createArtifact({
				logicalKey: `variant-${index}-evaluation`,
				kind: "evaluation",
				value: candidate.visualEvaluation,
				metadata: { variantIndex: index },
			});
			const variant = toPublicVariant(candidate);
			await stream.evaluation({
				variantIndex: index,
				evaluation: candidate.visualEvaluation,
			});
			return { outcome: completeOutcome(index, variant), candidate };
		} catch (error) {
			rethrowIfProcessorControlFlow(error);
			if (!isDegradableFailure(error)) throw error;
			await recordSafeFailure(context, index, stage, error);
			await stream.failure({
				variantIndex: index,
				stage,
				code: failureCode(error),
				retryable: error.retryable === true,
			});
			return { outcome: failedOutcome(index, stage, error), candidate: null };
		}
	}

	const settled = await Promise.allSettled(
		variants.map((variantProfile, index) =>
			processVariant(variantProfile, index),
		),
	);
	const rejections = settled
		.map((entry, index) => ({ entry, index }))
		.filter(({ entry }) => entry.status === "rejected")
		.map(({ entry, index }) => ({ error: entry.reason, index }));
	const controlFlowError = selectControlFlowError(rejections);
	if (controlFlowError) throw controlFlowError;
	if (rejections.length > 0) {
		throw rejections.sort((left, right) => left.index - right.index)[0].error;
	}

	const processed = settled.map((entry) => entry.value);
	const outcomes = Object.freeze(
		processed
			.map(({ outcome }) => outcome)
			.sort((left, right) => left.index - right.index),
	);
	const completeCandidates = processed
		.map(({ candidate }) => candidate)
		.filter(Boolean);
	const allComplete = outcomes.every(
		(outcome) => outcome.status === "complete",
	);
	const recommended = allComplete
		? stableBestCandidate(completeCandidates, scoreCandidate)
		: null;
	const recommendedVariantIndex = recommended?.variantIndex ?? null;
	const result = Object.freeze({
		outcomes,
		recommendedVariantIndex,
		recommendedVariant: recommended ? toPublicVariant(recommended) : null,
	});
	const sortedArtifactKeys = () => artifactKeys.slice().sort();
	const compactStatuses = compactOutcomes(outcomes);

	if (!allComplete) {
		await createArtifact({
			logicalKey: "analysis-attempt-summary",
			kind: "attempt-summary",
			value: assertCompactArtifact(
				{
					schemaVersion: 1,
					status: "failed",
					variants: compactStatuses,
					artifactReferences: sortedArtifactKeys(),
				},
				"analysis-attempt-summary",
			),
		});
		return result;
	}

	await createArtifact({
		logicalKey: "analysis-summary",
		kind: "result",
		value: assertCompactArtifact(
			{
				schemaVersion: 1,
				status: "complete",
				variants: compactStatuses,
				recommendedVariantIndex,
				artifactReferences: sortedArtifactKeys(),
			},
			"analysis-summary",
		),
	});
	await createArtifact({
		logicalKey: "analysis-manifest",
		kind: "manifest",
		value: assertCompactArtifact(
			{
				schemaVersion: 1,
				status: "complete",
				variants: compactStatuses,
				recommendedVariantIndex,
				artifactReferences: sortedArtifactKeys(),
			},
			"analysis-manifest",
		),
	});
	await stream.completion({
		recommendedVariantIndex,
		result: { recommendedVariantIndex },
	});
	return result;
}

import { assertProcessorActive } from "../shared/processorContext.js";
import { createProviderRequestIdFactory } from "../services/openRouter.js";

export function assertProcessorContextForJobKind(context, jobKind) {
	if (!context || typeof context !== "object" || !Object.isFrozen(context)) {
		throw new TypeError("An immutable processor context is required.");
	}
	if (context.modelProfile?.jobKind !== jobKind) {
		throw new TypeError(
			`Processor model profile must have canonical job kind ${jobKind}.`,
		);
	}
	assertProcessorActive(context, `${jobKind}-start`);
	return context;
}

export function requirePlainInput(input, name = "input") {
	if (
		!input ||
		typeof input !== "object" ||
		Array.isArray(input) ||
		Object.getPrototypeOf(input) !== Object.prototype
	) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	return input;
}

export function requireNonEmptyString(value, name) {
	if (typeof value !== "string" || !value.trim()) {
		throw new TypeError(`${name} is required.`);
	}
	return value;
}

export function requireOptionalNonEmptyString(value, fallback, name) {
	if (value === undefined) return fallback;
	return requireNonEmptyString(value, name);
}

export function requireDependencies(dependencies) {
	if (
		!dependencies ||
		typeof dependencies !== "object" ||
		Array.isArray(dependencies)
	) {
		throw new TypeError("Explicit processor dependencies are required.");
	}
	const apiKey = requireNonEmptyString(
		dependencies.apiKey,
		"dependencies.apiKey",
	);
	return { dependencies, apiKey };
}

export function serviceDependency(dependencies, name, fallback) {
	const service =
		dependencies[name] ?? dependencies.services?.[name] ?? fallback;
	if (typeof service !== "function") {
		throw new TypeError(`dependencies.${name} must be a function.`);
	}
	return service;
}

export function createProcessorRequestIdFactory(context, dependencies, prefix) {
	const factoryCreator = serviceDependency(
		dependencies,
		"createProviderRequestIdFactory",
		createProviderRequestIdFactory,
	);
	const nextProviderRequestId = factoryCreator({
		attemptId: context.identity.attemptId,
		prefix,
	});
	if (typeof nextProviderRequestId !== "function") {
		throw new TypeError(
			"Provider request-id factory creator must return a function.",
		);
	}
	return nextProviderRequestId;
}

export function contextExecutionOptions(
	context,
	provider,
	nextProviderRequestId,
) {
	return {
		context,
		signal: context.signal,
		applicationDeadlineAt: context.applicationDeadlineAt,
		absoluteJobDeadlineAt: context.absoluteJobDeadlineAt,
		effectiveDeadlineAt: context.effectiveDeadlineAt,
		provider,
		nextProviderRequestId,
	};
}

export async function awaitProcessorBoundary(context, stage, operation) {
	assertProcessorActive(context, stage);
	const value = await operation();
	assertProcessorActive(context, stage);
	return value;
}

export async function createCanonicalArtifact(
	context,
	{ logicalKey, kind, value, metadata },
) {
	return awaitProcessorBoundary(context, `artifact-${logicalKey}`, () =>
		context.artifactStore.create(
			{
				logicalKey,
				kind,
				value,
				...(metadata === undefined ? {} : { metadata }),
			},
			context,
		),
	);
}

export function canonicalScreenshot(renderedScreenshot) {
	if (!renderedScreenshot || typeof renderedScreenshot.base64 !== "string") {
		return null;
	}
	return {
		base64: renderedScreenshot.base64,
		mediaType: renderedScreenshot.mediaType || "image/png",
		fitDiagnostics: renderedScreenshot.fitDiagnostics || null,
	};
}

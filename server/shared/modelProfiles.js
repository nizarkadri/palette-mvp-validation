import {
	DEFAULT_MODEL_ID,
	GEMINI_IMAGE_VARIANT_MODEL_ID,
	GEMINI_LITE_IMAGE_VARIANT_MODEL_ID,
} from "../constants.js";

export const MODEL_PROFILE_REVISION = "model-profile-v1";
export const DEFAULT_MODEL_PROFILE_ID = "default";

const PROFILE_SCHEMA_VERSION = 1;
const OPENROUTER_PROVIDER_ID = "openrouter";
const OPENROUTER_REQUEST_TIMEOUT_MS = 120_000;

const REQUEST_CEILINGS = {
	maxInputTokens: 128_000,
	maxOutputTokens: 16_000,
};

const WORST_CASE_REQUEST_RESERVATION = {
	inputTokens: REQUEST_CEILINGS.maxInputTokens,
	outputTokens: REQUEST_CEILINGS.maxOutputTokens,
	costMicros: 5_000_000,
};

const ATTEMPT_LEDGER_CEILINGS = {
	analysis: {
		maxCalls: 60,
		maxInputTokens: 7_680_000,
		maxOutputTokens: 960_000,
		maxCostMicros: 300_000_000,
	},
	categorization: {
		maxCalls: 2,
		maxInputTokens: 256_000,
		maxOutputTokens: 32_000,
		maxCostMicros: 10_000_000,
	},
	improvement: {
		maxCalls: 12,
		maxInputTokens: 1_536_000,
		maxOutputTokens: 192_000,
		maxCostMicros: 60_000_000,
	},
	"custom-swatch": {
		maxCalls: 2,
		maxInputTokens: 256_000,
		maxOutputTokens: 32_000,
		maxCostMicros: 10_000_000,
	},
};

function deepFreeze(value) {
	if (value && typeof value === "object") {
		for (const nested of Object.values(value)) deepFreeze(nested);
		if (!Object.isFrozen(value)) Object.freeze(value);
	}
	return value;
}

function providerRequest(modelId, supportsToolUse) {
	return {
		providerId: OPENROUTER_PROVIDER_ID,
		modelId,
		requestTimeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
		supportsToolUse,
		requestCeilings: { ...REQUEST_CEILINGS },
		worstCaseReservation: { ...WORST_CASE_REQUEST_RESERVATION },
	};
}

function variantProfile(index, modelId, supportsToolUse) {
	return {
		schemaVersion: PROFILE_SCHEMA_VERSION,
		revision: MODEL_PROFILE_REVISION,
		id: `analysis-variant-${index}`,
		jobKind: "analysis",
		variantIndex: index,
		provider: providerRequest(modelId, supportsToolUse),
	};
}

function jobProfile({ id, jobKind, modelId, supportsToolUse }) {
	return {
		schemaVersion: PROFILE_SCHEMA_VERSION,
		revision: MODEL_PROFILE_REVISION,
		id,
		jobKind,
		attemptLedgerCeilings: { ...ATTEMPT_LEDGER_CEILINGS[jobKind] },
		provider: providerRequest(modelId, supportsToolUse),
	};
}

const analysisDefaultProfile = {
	schemaVersion: PROFILE_SCHEMA_VERSION,
	revision: MODEL_PROFILE_REVISION,
	id: DEFAULT_MODEL_PROFILE_ID,
	jobKind: "analysis",
	attemptLedgerCeilings: { ...ATTEMPT_LEDGER_CEILINGS.analysis },
	variants: [
		variantProfile(0, DEFAULT_MODEL_ID, true),
		variantProfile(1, GEMINI_IMAGE_VARIANT_MODEL_ID, false),
		variantProfile(2, GEMINI_LITE_IMAGE_VARIANT_MODEL_ID, false),
	],
};

const registry = {
	schemaVersion: PROFILE_SCHEMA_VERSION,
	revision: MODEL_PROFILE_REVISION,
	jobKinds: {
		analysis: {
			profiles: {
				[DEFAULT_MODEL_PROFILE_ID]: analysisDefaultProfile,
			},
		},
		categorization: {
			profiles: {
				[DEFAULT_MODEL_PROFILE_ID]: jobProfile({
					id: DEFAULT_MODEL_PROFILE_ID,
					jobKind: "categorization",
					modelId: DEFAULT_MODEL_ID,
					supportsToolUse: true,
				}),
			},
		},
		improvement: {
			profiles: {
				[DEFAULT_MODEL_PROFILE_ID]: jobProfile({
					id: DEFAULT_MODEL_PROFILE_ID,
					jobKind: "improvement",
					modelId: DEFAULT_MODEL_ID,
					supportsToolUse: true,
				}),
				"gemini-image": jobProfile({
					id: "gemini-image",
					jobKind: "improvement",
					modelId: GEMINI_IMAGE_VARIANT_MODEL_ID,
					supportsToolUse: false,
				}),
				"gemini-lite-image": jobProfile({
					id: "gemini-lite-image",
					jobKind: "improvement",
					modelId: GEMINI_LITE_IMAGE_VARIANT_MODEL_ID,
					supportsToolUse: false,
				}),
			},
		},
		"custom-swatch": {
			profiles: {
				[DEFAULT_MODEL_PROFILE_ID]: jobProfile({
					id: DEFAULT_MODEL_PROFILE_ID,
					jobKind: "custom-swatch",
					modelId: DEFAULT_MODEL_ID,
					supportsToolUse: true,
				}),
			},
		},
	},
};

export const MODEL_PROFILE_REGISTRY = deepFreeze(registry);

// Authenticity is identity-based rather than shape/revision-based. This keeps
// deeply frozen caller-fabricated copies out of processor boundaries.
const CANONICAL_JOB_PROFILES = new WeakSet();
const CANONICAL_PROVIDER_DESCRIPTORS = new WeakSet();
for (const jobKindEntry of Object.values(MODEL_PROFILE_REGISTRY.jobKinds)) {
	for (const profile of Object.values(jobKindEntry.profiles)) {
		CANONICAL_JOB_PROFILES.add(profile);
		if (profile.provider) CANONICAL_PROVIDER_DESCRIPTORS.add(profile.provider);
		for (const variant of profile.variants || []) {
			CANONICAL_PROVIDER_DESCRIPTORS.add(variant.provider);
		}
	}
}

export function isCanonicalModelProfile(profile) {
	return (
		profile !== null &&
		(typeof profile === "object" || typeof profile === "function") &&
		CANONICAL_JOB_PROFILES.has(profile)
	);
}

export function isCanonicalProviderDescriptor(provider) {
	return (
		provider !== null &&
		(typeof provider === "object" || typeof provider === "function") &&
		CANONICAL_PROVIDER_DESCRIPTORS.has(provider)
	);
}

export class ModelProfileResolutionError extends Error {
	constructor() {
		super("Requested model profile is not available.");
		this.name = "ModelProfileResolutionError";
		this.code = "MODEL_PROFILE_NOT_ALLOWED";
	}
}

function resolutionError() {
	return new ModelProfileResolutionError();
}

export function resolveModelProfile(jobKind, profileId) {
	if (typeof jobKind !== "string" || typeof profileId !== "string") {
		throw resolutionError();
	}
	const jobKinds = MODEL_PROFILE_REGISTRY.jobKinds;
	if (!Object.hasOwn(jobKinds, jobKind)) throw resolutionError();
	const profiles = jobKinds[jobKind].profiles;
	if (!Object.hasOwn(profiles, profileId)) throw resolutionError();
	const profile = profiles[profileId];
	if (profile.jobKind !== jobKind || profile.id !== profileId) {
		throw resolutionError();
	}
	return profile;
}

export function resolveAnalysisProfile(
	profileId = DEFAULT_MODEL_PROFILE_ID,
) {
	return resolveModelProfile("analysis", profileId);
}

export function resolveAnalysisVariantProfiles(
	profileId = DEFAULT_MODEL_PROFILE_ID,
) {
	return resolveAnalysisProfile(profileId).variants;
}

export function resolveAnalysisVariantProfile(
	variantIndex,
	profileId = DEFAULT_MODEL_PROFILE_ID,
) {
	if (!Number.isInteger(variantIndex)) throw resolutionError();
	const variants = resolveAnalysisVariantProfiles(profileId);
	const profile = variants[variantIndex];
	if (!profile || profile.variantIndex !== variantIndex) throw resolutionError();
	return profile;
}

const LEGACY_IMPROVEMENT_MODEL_PROFILE_IDS = deepFreeze({
	[DEFAULT_MODEL_ID]: DEFAULT_MODEL_PROFILE_ID,
	[GEMINI_IMAGE_VARIANT_MODEL_ID]: "gemini-image",
	[GEMINI_LITE_IMAGE_VARIANT_MODEL_ID]: "gemini-lite-image",
});

export function resolveLegacyImprovementModelProfile(rawModelId) {
	if (typeof rawModelId !== "string") throw resolutionError();
	const normalizedModelId = rawModelId.trim();
	if (!Object.hasOwn(LEGACY_IMPROVEMENT_MODEL_PROFILE_IDS, normalizedModelId)) {
		throw resolutionError();
	}
	return resolveModelProfile(
		"improvement",
		LEGACY_IMPROVEMENT_MODEL_PROFILE_IDS[normalizedModelId],
	);
}

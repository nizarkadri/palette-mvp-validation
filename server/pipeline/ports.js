import { systemClock } from "../shared/deadlines.js";
import { assertProcessorActive } from "../shared/processorContext.js";

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_STAGE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const DIAGNOSTIC_SEVERITIES = new Set(["info", "warn", "error"]);
const DIAGNOSTIC_STAGES = new Set([
	"artifact",
	"checkpoint",
	"cleanup",
	"complete",
	"evaluation",
	"generation",
	"preparing",
	"processing",
	"provider",
	"render",
]);
const DIAGNOSTIC_CODES = new Set([
	"ARTIFACT_WRITE_FAILED",
	"BUDGET_EXCEEDED",
	"CANCELLED",
	"CHECKPOINT_WRITE_FAILED",
	"CLEANUP_FAILED",
	"DEADLINE_EXCEEDED",
	"DIAGNOSTICS_FAILED",
	"FENCE_LOST",
	"LEASE_LOST",
	"PROVIDER_FAILED",
	"RENDER_FAILED",
	"SHUTDOWN",
]);

function requirePlainDataObject(value, name) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		(Object.getPrototypeOf(value) !== Object.prototype &&
			Object.getPrototypeOf(value) !== null)
	) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	if (Object.getOwnPropertySymbols(value).length > 0) {
		throw new TypeError(`${name} must not contain symbol fields.`);
	}
	for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
		if (!descriptor.enumerable || !("value" in descriptor)) {
			throw new TypeError(`${name} must contain only enumerable data fields.`);
		}
	}
	return value;
}

function requireExactFields(value, fields, name, { optional = new Set() } = {}) {
	for (const key of Object.keys(value)) {
		if (!fields.has(key)) {
			throw new TypeError(`${name}.${key} is not allowed.`);
		}
	}
	for (const key of fields) {
		if (!optional.has(key) && !Object.hasOwn(value, key)) {
			throw new TypeError(`${name}.${key} is required.`);
		}
	}
}

function requireNonEmptyString(value, name) {
	if (typeof value !== "string" || !value.trim()) {
		throw new TypeError(`${name} is required.`);
	}
	return value.trim();
}

function requireCanonicalMapKey(value, name) {
	const key = requireNonEmptyString(value, name);
	if (value !== key) {
		throw new TypeError(`${name} must not contain surrounding whitespace.`);
	}
	if (key === "__proto__" || key === "prototype" || key === "constructor") {
		throw new TypeError(`${name} is prohibited.`);
	}
	return key;
}

function requireDenseDataArray(value, name) {
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Object.getOwnPropertySymbols(value).length > 0) {
		throw new TypeError(`${name} must not contain symbol fields.`);
	}
	const expectedKeys = Array.from({ length: value.length }, (_, index) =>
		String(index),
	);
	const actualKeys = Object.keys(descriptors).filter((key) => key !== "length");
	if (
		actualKeys.length !== expectedKeys.length ||
		expectedKeys.some((key, index) => actualKeys[index] !== key)
	) {
		throw new TypeError(`${name} must be a dense data-only array.`);
	}
	for (const key of expectedKeys) {
		const descriptor = descriptors[key];
		if (!descriptor?.enumerable || !("value" in descriptor)) {
			throw new TypeError(`${name} must be a dense data-only array.`);
		}
	}
}

function requireSafeToken(value, name, pattern) {
	const token = requireNonEmptyString(value, name);
	if (!pattern.test(token)) {
		throw new TypeError(`${name} is not a safe token.`);
	}
	return token;
}

function requireGeneration(value, name) {
	if (
		(typeof value === "string" && value.trim()) ||
		(Number.isSafeInteger(value) && value >= 0)
	) {
		return typeof value === "string" ? value.trim() : value;
	}
	throw new TypeError(`${name} must be a non-empty string or non-negative integer.`);
}

function cloneAndFreezeData(value, name, ancestors = new Set()) {
	if (value === null || typeof value === "boolean" || typeof value === "string") {
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError(`${name} must contain only finite numbers.`);
		}
		return value;
	}
	if (typeof value !== "object" || ancestors.has(value)) {
		throw new TypeError(`${name} must contain acyclic data-only values.`);
	}

	if (value instanceof Uint8Array) {
		return new Uint8Array(value);
	}
	if (value instanceof ArrayBuffer) {
		return value.slice(0);
	}

	ancestors.add(value);
	if (Array.isArray(value)) {
		requireDenseDataArray(value, name);
		const copy = value.map((item, index) =>
			cloneAndFreezeData(item, `${name}[${index}]`, ancestors),
		);
		ancestors.delete(value);
		return Object.freeze(copy);
	}

	requirePlainDataObject(value, name);
	const copy = Object.create(null);
	for (const [key, nested] of Object.entries(value)) {
		if (key === "__proto__" || key === "prototype" || key === "constructor") {
			throw new TypeError(`${name} contains a prohibited key.`);
		}
		copy[key] = cloneAndFreezeData(nested, `${name}.${key}`, ancestors);
	}
	ancestors.delete(value);
	return Object.freeze(copy);
}

function isDeepFrozenData(value, ancestors = new Set()) {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return true;
	}
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value !== "object" || ancestors.has(value)) return false;
	if (!Object.isFrozen(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
		return false;
	}
	if (
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) !== Object.prototype &&
		Object.getPrototypeOf(value) !== null
	) {
		return false;
	}
	try {
		if (Array.isArray(value)) requireDenseDataArray(value, "value");
		else requirePlainDataObject(value, "value");
	} catch {
		return false;
	}

	ancestors.add(value);
	const valid = Object.values(value).every((nested) =>
		isDeepFrozenData(nested, ancestors),
	);
	ancestors.delete(value);
	return valid;
}

function copyForRead(value, name) {
	return cloneAndFreezeData(value, name);
}

function validateActivity(activity, stage) {
	assertProcessorActive(activity, stage);
	if (!activity.identity || typeof activity.identity !== "object") {
		throw new TypeError("operation activity requires processor identity.");
	}
}

function sameIdentity(left, right) {
	return (
		left.jobId === right.jobId &&
		left.attemptId === right.attemptId &&
		left.fenceToken === right.fenceToken
	);
}

function sanitizeIdentity(identity, name) {
	requirePlainDataObject(identity, name);
	requireExactFields(identity, new Set(["jobId", "attemptId", "fenceToken"]), name);
	if (!Number.isSafeInteger(identity.fenceToken) || identity.fenceToken < 0) {
		throw new TypeError(`${name}.fenceToken must be a non-negative safe integer.`);
	}
	return Object.freeze({
		jobId: requireNonEmptyString(identity.jobId, `${name}.jobId`),
		attemptId: requireNonEmptyString(identity.attemptId, `${name}.attemptId`),
		fenceToken: identity.fenceToken,
	});
}

function sanitizeChecksum(value, name) {
	return requireSafeToken(value, name, CHECKSUM_PATTERN);
}

function sanitizeChecksumMap(value, name, { requireEntries = false } = {}) {
	requirePlainDataObject(value, name);
	if (requireEntries && Object.keys(value).length === 0) {
		throw new TypeError(`${name} must not be empty.`);
	}
	const copy = Object.create(null);
	for (const [key, checksum] of Object.entries(value)) {
		const logicalKey = requireCanonicalMapKey(key, `${name} key`);
		if (Object.hasOwn(copy, logicalKey)) {
			throw new TypeError(`${name} contains a duplicate logical key.`);
		}
		copy[logicalKey] = sanitizeChecksum(checksum, `${name}.${logicalKey}`);
	}
	return Object.freeze(copy);
}

const PROVENANCE_FIELDS = new Set([
	"provenanceHash",
	"input",
	"sourceManifest",
	"optionsHash",
	"processorRevision",
	"promptRevision",
	"modelProfileRevision",
	"stageRevision",
	"dependencyChecksums",
	"outputArtifacts",
]);

function sanitizeProvenance(provenance, name) {
	requirePlainDataObject(provenance, name);
	requireExactFields(provenance, PROVENANCE_FIELDS, name);

	const input = requirePlainDataObject(provenance.input, `${name}.input`);
	requireExactFields(input, new Set(["generation", "sha256"]), `${name}.input`);
	const sourceManifest = requirePlainDataObject(
		provenance.sourceManifest,
		`${name}.sourceManifest`,
	);
	requireExactFields(
		sourceManifest,
		new Set(["generation", "checksum"]),
		`${name}.sourceManifest`,
	);
	const outputArtifacts = requirePlainDataObject(
		provenance.outputArtifacts,
		`${name}.outputArtifacts`,
	);
	if (Object.keys(outputArtifacts).length === 0) {
		throw new TypeError(`${name}.outputArtifacts must not be empty.`);
	}
	const sanitizedOutputs = Object.create(null);
	for (const [logicalKey, reference] of Object.entries(outputArtifacts)) {
		const canonicalKey = requireCanonicalMapKey(
			logicalKey,
			"output artifact key",
		);
		if (Object.hasOwn(sanitizedOutputs, canonicalKey)) {
			throw new TypeError(`${name}.outputArtifacts contains a duplicate key.`);
		}
		requirePlainDataObject(reference, `${name}.outputArtifacts.${logicalKey}`);
		requireExactFields(
			reference,
			new Set(["generation", "checksum"]),
			`${name}.outputArtifacts.${logicalKey}`,
		);
		sanitizedOutputs[canonicalKey] = Object.freeze({
			generation: requireGeneration(
				reference.generation,
				`${name}.outputArtifacts.${logicalKey}.generation`,
			),
			checksum: sanitizeChecksum(
				reference.checksum,
				`${name}.outputArtifacts.${logicalKey}.checksum`,
			),
		});
	}

	return Object.freeze({
		provenanceHash: sanitizeChecksum(
			provenance.provenanceHash,
			`${name}.provenanceHash`,
		),
		input: Object.freeze({
			generation: requireGeneration(
				input.generation,
				`${name}.input.generation`,
			),
			sha256: sanitizeChecksum(input.sha256, `${name}.input.sha256`),
		}),
		sourceManifest: Object.freeze({
			generation: requireGeneration(
				sourceManifest.generation,
				`${name}.sourceManifest.generation`,
			),
			checksum: sanitizeChecksum(
				sourceManifest.checksum,
				`${name}.sourceManifest.checksum`,
			),
		}),
		optionsHash: sanitizeChecksum(provenance.optionsHash, `${name}.optionsHash`),
		processorRevision: requireNonEmptyString(
			provenance.processorRevision,
			`${name}.processorRevision`,
		),
		promptRevision: requireNonEmptyString(
			provenance.promptRevision,
			`${name}.promptRevision`,
		),
		modelProfileRevision: requireNonEmptyString(
			provenance.modelProfileRevision,
			`${name}.modelProfileRevision`,
		),
		stageRevision: requireNonEmptyString(
			provenance.stageRevision,
			`${name}.stageRevision`,
		),
		dependencyChecksums: sanitizeChecksumMap(
			provenance.dependencyChecksums,
			`${name}.dependencyChecksums`,
		),
		outputArtifacts: Object.freeze(sanitizedOutputs),
	});
}

function dataEquals(left, right) {
	if (left === right) return true;
	if (!left || !right || typeof left !== "object" || typeof right !== "object") {
		return false;
	}
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key) => Object.hasOwn(right, key) && dataEquals(left[key], right[key]),
		)
	);
}

/**
 * Production-safe diagnostics capability. It accepts calls but deliberately
 * retains nothing and has no artifact/checkpoint methods.
 */
export function createNoopDiagnostics() {
	return Object.freeze({
		async record() {},
		list: () => Object.freeze([]),
	});
}

/**
 * Metadata-only diagnostics for tests/development. Message, payload, error,
 * prompt, HTML, image, and any other caller fields are discarded.
 */
export function createRedactedInMemoryDiagnostics({ clock = systemClock } = {}) {
	if (!clock || typeof clock.now !== "function") {
		throw new TypeError("diagnostics clock must provide now().");
	}
	const records = [];

	return Object.freeze({
		async record(entry = {}) {
			requirePlainDataObject(entry, "diagnostic entry");
			const severity = entry.severity ?? "info";
			if (!DIAGNOSTIC_SEVERITIES.has(severity)) {
				throw new TypeError("diagnostic entry severity is not supported.");
			}
			const record = Object.freeze({
				severity,
				stage: DIAGNOSTIC_STAGES.has(entry.stage) ? entry.stage : "processing",
				code: DIAGNOSTIC_CODES.has(entry.code) ? entry.code : "REDACTED",
				recordedAt: clock.now(),
			});
			if (!Number.isFinite(record.recordedAt)) {
				throw new TypeError("diagnostics clock returned an invalid time.");
			}
			records.push(record);
			return record;
		},
		list() {
			return Object.freeze(records.map((record) => Object.freeze({ ...record })));
		},
	});
}

/**
 * @typedef {object} ArtifactInput
 * @property {string} logicalKey Stable canonical key.
 * @property {string} kind Transport-neutral artifact kind.
 * @property {*} value Canonical data (including Uint8Array screenshots).
 * @property {object} [metadata] Non-sensitive canonical metadata.
 */

/** Create-only canonical artifact storage for Phase 01. */
export function createInMemoryArtifactStore() {
	const artifacts = new Map();

	return Object.freeze({
		/** @param {ArtifactInput} artifact @param {object} activity Processor context. */
		async create(artifact, activity) {
			validateActivity(activity, "artifact-create");
			requirePlainDataObject(artifact, "artifact");
			requireExactFields(
				artifact,
				new Set(["logicalKey", "kind", "value", "metadata"]),
				"artifact",
				{ optional: new Set(["metadata"]) },
			);
			const snapshot = Object.freeze({
				logicalKey: requireNonEmptyString(artifact.logicalKey, "artifact.logicalKey"),
				kind: requireNonEmptyString(artifact.kind, "artifact.kind"),
				value: cloneAndFreezeData(artifact.value, "artifact.value"),
				metadata: cloneAndFreezeData(artifact.metadata ?? {}, "artifact.metadata"),
			});

			await Promise.resolve();
			validateActivity(activity, "artifact-create");
			if (artifacts.has(snapshot.logicalKey)) {
				throw new Error(`Artifact logical key already exists: ${snapshot.logicalKey}`);
			}
			artifacts.set(snapshot.logicalKey, snapshot);
			await Promise.resolve();
			validateActivity(activity, "artifact-create");
			return copyForRead(snapshot, "artifact");
		},
		get(logicalKey) {
			const artifact = artifacts.get(logicalKey);
			return artifact ? copyForRead(artifact, "artifact") : undefined;
		},
		list() {
			return Object.freeze(
				[...artifacts.values()]
					.sort((left, right) => left.logicalKey.localeCompare(right.logicalKey))
					.map((artifact) => copyForRead(artifact, "artifact")),
			);
		},
	});
}

const CHECKPOINT_FIELDS = new Set([
	"logicalKey",
	"stageKey",
	"status",
	"validated",
	"identity",
	"provenance",
	"value",
]);

/**
 * Create-only checkpoint storage. The expected provenance is a separate trusted
 * argument so a checkpoint cannot validate itself. Inputs must already be
 * deeply frozen, making the completion decision explicit before persistence.
 */
export function createInMemoryCheckpointStore() {
	const checkpoints = new Map();

	return Object.freeze({
		async createCompleted(checkpoint, activity, expectedProvenance) {
			validateActivity(activity, "checkpoint-create");
			if (!isDeepFrozenData(checkpoint)) {
				throw new TypeError("checkpoint must be deeply frozen immutable data.");
			}
			if (!isDeepFrozenData(expectedProvenance)) {
				throw new TypeError("expected provenance must be deeply frozen immutable data.");
			}
			requirePlainDataObject(checkpoint, "checkpoint");
			requireExactFields(checkpoint, CHECKPOINT_FIELDS, "checkpoint");
			if (checkpoint.status !== "completed") {
				throw new TypeError("checkpoint.status must be completed.");
			}
			if (checkpoint.validated !== true) {
				throw new TypeError("checkpoint must be validated.");
			}

			const identity = sanitizeIdentity(checkpoint.identity, "checkpoint.identity");
			if (!sameIdentity(identity, activity.identity)) {
				throw new Error("checkpoint identity or fence does not match the active processor.");
			}
			const provenance = sanitizeProvenance(checkpoint.provenance, "checkpoint.provenance");
			const expected = sanitizeProvenance(expectedProvenance, "expectedProvenance");
			if (!dataEquals(provenance, expected)) {
				throw new Error("checkpoint provenance does not match the expected provenance.");
			}
			if (provenance.modelProfileRevision !== activity.modelProfileRevision) {
				throw new Error("checkpoint model-profile provenance does not match the processor context.");
			}
			const stageKey = requireSafeToken(
				checkpoint.stageKey,
				"checkpoint.stageKey",
				SAFE_STAGE_PATTERN,
			);
			const expectedLogicalKey = `${provenance.provenanceHash}_${stageKey}`;
			if (checkpoint.logicalKey !== expectedLogicalKey) {
				throw new Error("checkpoint logical key does not match its provenance and stage.");
			}
			const snapshot = Object.freeze({
				logicalKey: expectedLogicalKey,
				stageKey,
				status: "completed",
				validated: true,
				identity,
				provenance,
				value: cloneAndFreezeData(checkpoint.value, "checkpoint.value"),
			});

			await Promise.resolve();
			validateActivity(activity, "checkpoint-create");
			if (checkpoints.has(snapshot.logicalKey)) {
				throw new Error(`Checkpoint logical key already exists: ${snapshot.logicalKey}`);
			}
			checkpoints.set(snapshot.logicalKey, snapshot);
			await Promise.resolve();
			validateActivity(activity, "checkpoint-create");
			return copyForRead(snapshot, "checkpoint");
		},
		get(logicalKey) {
			const checkpoint = checkpoints.get(logicalKey);
			return checkpoint ? copyForRead(checkpoint, "checkpoint") : undefined;
		},
		list() {
			return Object.freeze(
				[...checkpoints.values()]
					.sort((left, right) => left.logicalKey.localeCompare(right.logicalKey))
					.map((checkpoint) => copyForRead(checkpoint, "checkpoint")),
			);
		},
	});
}

function safeWarn(logger, message, details) {
	try {
		logger.warn(message, details);
	} catch {
		// Logging is secondary and must not replace processor control flow.
	}
}

/**
 * Runs cleanup after every outcome. A primary error always wins over cleanup,
 * logging, and diagnostics failures; when work succeeds, cleanup failure is
 * still surfaced rather than being converted into diagnostic success.
 */
export async function runWithNonMaskingCleanup({
	work,
	cleanup,
	logger,
	diagnostics,
} = {}) {
	if (typeof work !== "function" || typeof cleanup !== "function") {
		throw new TypeError("work and cleanup must be functions.");
	}
	if (!logger || typeof logger.warn !== "function") {
		throw new TypeError("logger must provide warn().");
	}
	if (!diagnostics || typeof diagnostics.record !== "function") {
		throw new TypeError("diagnostics must provide record().");
	}

	let result;
	let primaryError;
	let primaryFailed = false;
	try {
		result = await work();
	} catch (error) {
		primaryFailed = true;
		primaryError = error;
	}

	let cleanupError;
	let cleanupFailed = false;
	try {
		await cleanup();
	} catch (error) {
		cleanupFailed = true;
		cleanupError = error;
		safeWarn(logger, "Processor cleanup failed.", {
			code: "CLEANUP_FAILED",
			hadPrimaryError: primaryFailed,
		});
		try {
			await diagnostics.record({
				severity: "warn",
				stage: "cleanup",
				code: "CLEANUP_FAILED",
			});
		} catch {
			safeWarn(logger, "Processor cleanup diagnostics failed.", {
				code: "DIAGNOSTICS_FAILED",
			});
		}
	}

	if (primaryFailed) throw primaryError;
	if (cleanupFailed) throw cleanupError;
	return result;
}

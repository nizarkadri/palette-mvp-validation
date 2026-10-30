import { describe, expect, it, vi } from "vitest";
import {
	createInMemoryArtifactStore,
	createInMemoryCheckpointStore,
	createNoopDiagnostics,
	createRedactedInMemoryDiagnostics,
	runWithNonMaskingCleanup,
} from "../ports.js";
import { ProcessorCancelledError, ProcessorDeadlineExceededError } from "../../shared/errors.js";
import { createContextFixture, createManualClock } from "../../shared/__tests__/testUtils.js";

const HASHES = Object.freeze({
	provenance: "a".repeat(64),
	input: "b".repeat(64),
	manifest: "c".repeat(64),
	options: "d".repeat(64),
	dependency: "e".repeat(64),
	output: "f".repeat(64),
});

function deepFreeze(value) {
	if (value && typeof value === "object") {
		for (const nested of Object.values(value)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}

function frozenMap(entries) {
	const value = Object.create(null);
	for (const [key, nested] of entries) value[key] = nested;
	return deepFreeze(value);
}

function provenance(overrides = {}) {
	return deepFreeze({
		provenanceHash: HASHES.provenance,
		input: { generation: "input-generation-1", sha256: HASHES.input },
		sourceManifest: {
			generation: "manifest-generation-1",
			checksum: HASHES.manifest,
		},
		optionsHash: HASHES.options,
		processorRevision: "analysis-v1",
		promptRevision: "prompt-v1",
		modelProfileRevision: "model-profile-v1",
		stageRevision: "generation-v1",
		dependencyChecksums: { "source-manifest": HASHES.dependency },
		outputArtifacts: {
			"variant-0-html": { generation: "artifact-generation-1", checksum: HASHES.output },
		},
		...overrides,
	});
}

function checkpoint(overrides = {}) {
	const expectedProvenance = overrides.provenance ?? provenance();
	return deepFreeze({
		logicalKey: `${expectedProvenance.provenanceHash}_generated`,
		stageKey: "generated",
		status: "completed",
		validated: true,
		identity: { jobId: "job-1", attemptId: "attempt-1", fenceToken: 7 },
		provenance: expectedProvenance,
		value: { artifactKeys: ["variant-0-html"] },
		...overrides,
	});
}

describe("diagnostics ports", () => {
	it("provides a true no-op capability with no canonical storage methods", async () => {
		const diagnostics = createNoopDiagnostics();

		await expect(
			diagnostics.record({
				variantIndex: 2,
				error: new Error("sk-secret"),
				payload: "sk-secret",
				html: "<main>private</main>",
			}),
		).resolves.toBeUndefined();
		expect(diagnostics.list()).toEqual([]);
		expect(diagnostics).not.toHaveProperty("create");
		expect(diagnostics).not.toHaveProperty("createCompleted");
	});

	it("retains only bounded safe metadata and drops sensitive caller payloads", async () => {
		const secret = "sk-provider-private-prompt";
		const diagnostics = createRedactedInMemoryDiagnostics({
			clock: { now: () => 1_234 },
		});

		await diagnostics.record({
			severity: "warn",
			stage: "generation",
			code: "PROVIDER_FAILED",
			variantIndex: 2,
			message: secret,
			payload: { prompt: secret },
			error: new Error(secret),
		});

		expect(diagnostics.list()).toEqual([
			{
				severity: "warn",
				stage: "generation",
				code: "PROVIDER_FAILED",
				recordedAt: 1_234,
			},
		]);
		expect(JSON.stringify(diagnostics.list())).not.toContain(secret);

		await diagnostics.record({
			severity: "error",
			stage: "sk-secret-stage",
			code: "SECRET_TOKEN_VALUE",
		});
		expect(diagnostics.list()[1]).toEqual({
			severity: "error",
			stage: "processing",
			code: "REDACTED",
			recordedAt: 1_234,
		});
		expect(JSON.stringify(diagnostics.list())).not.toMatch(/secret|token_value/i);
	});
});

describe("in-memory artifact store", () => {
	it("retains canonical immutable copies and rejects duplicate logical keys", async () => {
		const context = createContextFixture();
		const store = createInMemoryArtifactStore();
		const source = {
			logicalKey: "variant-0-html",
			kind: "html",
			value: { html: "<main>canonical</main>", evaluation: { score: 91 } },
			metadata: { variantIndex: 0 },
		};

		const created = await store.create(source, context);
		source.value.html = "changed by caller";
		source.value.evaluation.score = 0;
		expect(created.value.html).toBe("<main>canonical</main>");
		expect(Object.isFrozen(created)).toBe(true);
		expect(Object.isFrozen(created.value.evaluation)).toBe(true);
		expect(store.get("variant-0-html").value.evaluation.score).toBe(91);
		await expect(store.create(source, context)).rejects.toThrow("already exists");
		expect(store.list()).toHaveLength(1);
	});

	it("defensively copies screenshot bytes on write and read", async () => {
		const context = createContextFixture();
		const store = createInMemoryArtifactStore();
		const bytes = new Uint8Array([1, 2, 3]);

		await store.create(
			{ logicalKey: "variant-0-screenshot", kind: "screenshot", value: bytes },
			context,
		);
		bytes[0] = 9;
		const firstRead = store.get("variant-0-screenshot");
		firstRead.value[1] = 8;
		expect([...store.get("variant-0-screenshot").value]).toEqual([1, 2, 3]);
	});

	it("keeps canonical output when production diagnostics is a no-op", async () => {
		const context = createContextFixture();
		const diagnostics = createNoopDiagnostics();
		const store = createInMemoryArtifactStore();

		await diagnostics.record({ payload: "must not be canonical" });
		await store.create(
			{
				logicalKey: "manifest",
				kind: "manifest",
				value: { artifactKeys: ["variant-0-html"] },
			},
			context,
		);

		expect(diagnostics.list()).toEqual([]);
		expect(store.get("manifest").value.artifactKeys).toEqual(["variant-0-html"]);
	});

	it("checks cancellation/deadline before and after the asynchronous write seam", async () => {
		const expiredClock = createManualClock(1_000);
		const expiredContext = createContextFixture({
			clock: expiredClock,
			applicationDeadlineAt: 1_000,
			absoluteJobDeadlineAt: 1_000,
		});
		const store = createInMemoryArtifactStore();
		await expect(
			store.create({ logicalKey: "late", kind: "html", value: {} }, expiredContext),
		).rejects.toBeInstanceOf(ProcessorDeadlineExceededError);
		expect(store.get("late")).toBeUndefined();

		const controller = new AbortController();
		const context = createContextFixture({ controller, signal: controller.signal });
		const pending = store.create(
			{ logicalKey: "cancelled-after-write", kind: "html", value: {} },
			context,
		);
		queueMicrotask(() => controller.abort());
		await expect(pending).rejects.toBeInstanceOf(ProcessorCancelledError);
		expect(store.get("cancelled-after-write")).toBeDefined();
	});
});

describe("in-memory checkpoint store", () => {
	it("creates only completed validated provenance-bound immutable checkpoints", async () => {
		const context = createContextFixture();
		const diagnostics = createNoopDiagnostics();
		const store = createInMemoryCheckpointStore();
		const expected = provenance();
		const input = checkpoint({ provenance: expected });

		await diagnostics.record({ value: "not canonical" });
		const created = await store.createCompleted(input, context, expected);
		expect(diagnostics.list()).toEqual([]);
		expect(created).toEqual(input);
		expect(Object.isFrozen(created)).toBe(true);
		expect(Object.isFrozen(created.provenance.dependencyChecksums)).toBe(true);
		expect(Object.isFrozen(store.get(input.logicalKey).value.artifactKeys)).toBe(true);
		await expect(
			store.createCompleted(input, context, expected),
		).rejects.toThrow("already exists");
	});

	it.each([
		["partial", { status: "partial" }, "status must be completed"],
		["unvalidated", { validated: false }, "must be validated"],
		[
			"attempt identity mismatch",
			{ identity: { jobId: "job-1", attemptId: "attempt-other", fenceToken: 7 } },
			"identity or fence",
		],
		[
			"fence mismatch",
			{ identity: { jobId: "job-1", attemptId: "attempt-1", fenceToken: 8 } },
			"identity or fence",
		],
	])("rejects %s checkpoints", async (_name, override, message) => {
		const store = createInMemoryCheckpointStore();
		const expected = provenance();
		await expect(
			store.createCompleted(checkpoint({ provenance: expected, ...override }), createContextFixture(), expected),
		).rejects.toThrow(message);
	});

	it("rejects mutable checkpoint values instead of silently snapshotting them", async () => {
		const expected = provenance();
		const mutable = {
			...checkpoint({ provenance: expected }),
			value: { artifactKeys: ["variant-0-html"] },
		};
		await expect(
			createInMemoryCheckpointStore().createCompleted(
				mutable,
				createContextFixture(),
				expected,
			),
		).rejects.toThrow("deeply frozen");
	});

	it("rejects incomplete provenance", async () => {
		const complete = provenance();
		const { promptRevision: _missing, ...partial } = complete;
		const partialProvenance = deepFreeze(partial);
		await expect(
			createInMemoryCheckpointStore().createCompleted(
				checkpoint({ provenance: partialProvenance }),
				createContextFixture(),
				partialProvenance,
			),
		).rejects.toThrow("promptRevision is required");
	});

	it.each([
		[
			"surrounding whitespace in dependency keys",
			{ dependencyChecksums: frozenMap([[" source-manifest ", HASHES.dependency]]) },
			"surrounding whitespace",
		],
		[
			"prohibited dependency keys",
			{ dependencyChecksums: frozenMap([["__proto__", HASHES.dependency]]) },
			"prohibited",
		],
		[
			"surrounding whitespace in output keys",
			{
				outputArtifacts: frozenMap([
					[
						" variant-0-html ",
						deepFreeze({
							generation: "artifact-generation-1",
							checksum: HASHES.output,
						}),
					],
				]),
			},
			"surrounding whitespace",
		],
		[
			"prohibited output keys",
			{
				outputArtifacts: frozenMap([
					[
						"constructor",
						deepFreeze({
							generation: "artifact-generation-1",
							checksum: HASHES.output,
						}),
					],
				]),
			},
			"prohibited",
		],
	])("rejects %s without persisting an unreadable checkpoint", async (_name, changed, message) => {
		const store = createInMemoryCheckpointStore();
		const malformed = provenance(changed);
		await expect(
			store.createCompleted(
				checkpoint({ provenance: malformed }),
				createContextFixture(),
				malformed,
			),
		).rejects.toThrow(message);
		expect(store.list()).toEqual([]);
	});

	it.each(["accessor", "symbol", "non-enumerable"])(
		"rejects deeply frozen arrays with hidden %s state",
		async (kind) => {
			const hidden = [];
			if (kind === "accessor") {
				Object.defineProperty(hidden, "0", {
					enumerable: true,
					configurable: false,
					get: () => "variant-0-html",
				});
			} else {
				hidden.push("variant-0-html");
				if (kind === "symbol") hidden[Symbol("secret")] = "private";
				else Object.defineProperty(hidden, "secret", { value: "private" });
			}
			Object.freeze(hidden);
			const expected = provenance();
			const malformed = deepFreeze({
				...checkpoint({ provenance: expected }),
				value: deepFreeze({ artifactKeys: hidden }),
			});
			const store = createInMemoryCheckpointStore();
			await expect(
				store.createCompleted(malformed, createContextFixture(), expected),
			).rejects.toThrow("deeply frozen");
			expect(store.list()).toEqual([]);
		},
	);

	it.each([
		[
			"input",
			{ input: { generation: "different-input", sha256: HASHES.input } },
		],
		[
			"dependency",
			{ dependencyChecksums: { "source-manifest": "1".repeat(64) } },
		],
		["processor", { processorRevision: "analysis-v2" }],
		["profile", { modelProfileRevision: "model-profile-v2" }],
		["provenance hash", { provenanceHash: "2".repeat(64) }],
	])("rejects %s provenance mismatches", async (_name, changed) => {
		const expected = provenance();
		const mismatched = provenance(changed);
		await expect(
			createInMemoryCheckpointStore().createCompleted(
				checkpoint({ provenance: mismatched }),
				createContextFixture(),
				expected,
			),
		).rejects.toThrow("provenance does not match");
	});

	it("binds model-profile provenance directly to the processor context", async () => {
		const changed = provenance({ modelProfileRevision: "model-profile-v2" });
		await expect(
			createInMemoryCheckpointStore().createCompleted(
				checkpoint({ provenance: changed }),
				createContextFixture(),
				changed,
			),
		).rejects.toThrow("model-profile provenance");
	});

	it("rejects logical keys not bound to provenance hash and stage", async () => {
		const expected = provenance();
		await expect(
			createInMemoryCheckpointStore().createCompleted(
				checkpoint({ logicalKey: "forged", provenance: expected }),
				createContextFixture(),
				expected,
			),
		).rejects.toThrow("logical key does not match");
	});

	it("checks activity after the asynchronous checkpoint write", async () => {
		const controller = new AbortController();
		const context = createContextFixture({ controller, signal: controller.signal });
		const store = createInMemoryCheckpointStore();
		const expected = provenance();
		const input = checkpoint({ provenance: expected });
		const pending = store.createCompleted(input, context, expected);
		queueMicrotask(() => controller.abort());

		await expect(pending).rejects.toBeInstanceOf(ProcessorCancelledError);
		expect(store.get(input.logicalKey)).toBeDefined();
	});
});

describe("non-masking cleanup", () => {
	it.each([
		["cancellation", new ProcessorCancelledError({ stage: "render" })],
		["provider failure", new Error("provider failed")],
		["browser failure", new Error("browser failed")],
	])("runs cleanup after %s without replacing the primary error", async (_name, primary) => {
		const cleanup = vi.fn();
		await expect(
			runWithNonMaskingCleanup({
				work: vi.fn().mockRejectedValue(primary),
				cleanup,
				logger: { warn: vi.fn() },
				diagnostics: createNoopDiagnostics(),
			}),
		).rejects.toBe(primary);
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("preserves primary failure when cleanup and diagnostics also fail", async () => {
		const primary = new Error("primary provider failure");
		const cleanup = new Error("cleanup browser failure");
		const logger = { warn: vi.fn() };
		const diagnostics = { record: vi.fn().mockRejectedValue(new Error("diagnostics failed")) };

		await expect(
			runWithNonMaskingCleanup({
				work: vi.fn().mockRejectedValue(primary),
				cleanup: vi.fn().mockRejectedValue(cleanup),
				logger,
				diagnostics,
			}),
		).rejects.toBe(primary);
		expect(diagnostics.record).toHaveBeenCalledWith({
			severity: "warn",
			stage: "cleanup",
			code: "CLEANUP_FAILED",
		});
		expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(cleanup.message);
	});

	it("surfaces cleanup failure after successful primary work even with no-op diagnostics", async () => {
		const cleanupError = new Error("cleanup failed");
		await expect(
			runWithNonMaskingCleanup({
				work: async () => "canonical-result",
				cleanup: vi.fn().mockRejectedValue(cleanupError),
				logger: { warn: vi.fn() },
				diagnostics: createNoopDiagnostics(),
			}),
		).rejects.toBe(cleanupError);
	});

	it("returns primary result after successful cleanup", async () => {
		const cleanup = vi.fn();
		await expect(
			runWithNonMaskingCleanup({
				work: async () => "canonical-result",
				cleanup,
				logger: { warn: vi.fn() },
				diagnostics: createNoopDiagnostics(),
			}),
		).resolves.toBe("canonical-result");
		expect(cleanup).toHaveBeenCalledOnce();
	});
});

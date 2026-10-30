import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let debugRoot;
let debug;

beforeAll(async () => {
	debugRoot = await mkdtemp(path.join(os.tmpdir(), "palette-debug-test-"));
	vi.resetModules();
	vi.doMock("../../constants.js", () => ({ DEBUG_ROOT: debugRoot }));
	debug = await import("../debug.js");
});

afterAll(async () => {
	vi.doUnmock("../../constants.js");
	await rm(debugRoot, { recursive: true, force: true });
});

describe("development debug filesystem characterization", () => {
	it("creates timestamped sessions with stable absolute and relative paths", async () => {
		const session = await debug.createDebugSession();

		expect(session.id).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9]{6}$/,
		);
		expect(session.dir).toBe(path.join(debugRoot, session.id));
		expect(session.relativeDir).toBe(path.relative(process.cwd(), session.dir));
	});

	it("writes UTF-8 text and two-space formatted JSON", async () => {
		const session = await debug.createDebugSession();

		await debug.writeDebugText(session, "message.txt", "héllo");
		await debug.writeDebugJson(session, "payload.json", {
			ok: true,
			nested: { count: 3 },
		});

		await expect(
			readFile(path.join(session.dir, "message.txt"), "utf8"),
		).resolves.toBe("héllo");
		await expect(
			readFile(path.join(session.dir, "payload.json"), "utf8"),
		).resolves.toBe('{\n  "ok": true,\n  "nested": {\n    "count": 3\n  }\n}');
	});

	it.each([
		["image/jpeg", "jpg"],
		["image/webp", "webp"],
		["image/gif", "gif"],
		["image/unknown", "png"],
	])("decodes base64 bytes using the %s extension mapping", async (mediaType, extension) => {
		const session = await debug.createDebugSession();
		const expected = Buffer.from([0, 1, 2, 253, 254, 255]);

		await debug.writeDebugImage(
			session,
			expected.toString("base64"),
			mediaType,
		);

		await expect(
			readFile(path.join(session.dir, `request-image.${extension}`)),
		).resolves.toEqual(expected);
	});
});

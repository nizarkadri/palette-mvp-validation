import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEBUG_ROOT } from "../constants.js";

function createDebugId() {
	return `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
}

export async function createDebugSession() {
	const id = createDebugId();
	const dir = path.join(DEBUG_ROOT, id);
	await mkdir(dir, { recursive: true });
	return {
		id,
		dir,
		relativeDir: path.relative(process.cwd(), dir),
	};
}

export async function writeDebugText(session, fileName, content) {
	if (!session) return;
	await writeFile(path.join(session.dir, fileName), content, "utf8");
}

export async function writeDebugJson(session, fileName, payload) {
	if (!session) return;
	await writeDebugText(session, fileName, JSON.stringify(payload, null, 2));
}

function mediaTypeToExtension(mediaType) {
	if (mediaType === "image/jpeg") return "jpg";
	if (mediaType === "image/webp") return "webp";
	if (mediaType === "image/gif") return "gif";
	return "png";
}

export async function writeDebugImage(session, base64, mediaType) {
	if (!session) return;
	await writeFile(
		path.join(session.dir, `request-image.${mediaTypeToExtension(mediaType)}`),
		Buffer.from(base64, "base64"),
	);
}

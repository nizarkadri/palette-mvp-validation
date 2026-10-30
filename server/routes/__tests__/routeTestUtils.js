import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

export function createRequest({ method = "POST", body, rawBody } = {}) {
	const serialized =
		rawBody ?? (body === undefined ? "" : JSON.stringify(body));
	const req = Readable.from(serialized ? [serialized] : []);
	req.method = method;
	return req;
}

export function createResponse() {
	const headers = new Map();
	const chunks = [];
	const response = new EventEmitter();

	return Object.assign(response, {
		statusCode: 0,
		ended: false,
		finished: false,
		writableEnded: false,
		headers,
		chunks,
		setHeader(name, value) {
			headers.set(String(name).toLowerCase(), value);
		},
		getHeader(name) {
			return headers.get(String(name).toLowerCase());
		},
		write(chunk) {
			chunks.push(String(chunk));
			return true;
		},
		end(chunk) {
			if (chunk !== undefined) chunks.push(String(chunk));
			this.ended = true;
			this.finished = true;
			this.writableEnded = true;
		},
		text() {
			return chunks.join("");
		},
		json() {
			try {
				return JSON.parse(chunks.join(""));
			} catch (error) {
				throw new Error("Test response did not contain valid JSON.", {
					cause: error,
				});
			}
		},
		ndjson() {
			return chunks
				.join("")
				.split("\n")
				.filter((line) => line.trim())
				.map((line) => {
					try {
						return JSON.parse(line);
					} catch (error) {
						throw new Error("Test response contained invalid NDJSON.", {
							cause: error,
						});
					}
				});
		},
	});
}

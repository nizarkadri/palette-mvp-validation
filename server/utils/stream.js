export function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
			if (body.length > 15 * 1024 * 1024) {
				reject(new Error("Request body too large."));
				req.destroy();
			}
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(body || "{}"));
			} catch {
				reject(new Error("Invalid JSON request body."));
			}
		});
		req.on("error", reject);
	});
}

export function sendJson(res, statusCode, payload) {
	res.statusCode = statusCode;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(payload));
}

export function setupNdjsonStream(res) {
	res.statusCode = 200;
	res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
	res.setHeader("Cache-Control", "no-cache, no-transform");
	res.setHeader("Connection", "keep-alive");
}

export function sendStreamEvent(res, event) {
	res.write(`${JSON.stringify(event)}\n`);
}

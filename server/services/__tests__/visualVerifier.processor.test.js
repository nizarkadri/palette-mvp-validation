import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContextFixture } from "../../shared/__tests__/testUtils.js";

const browserFixture = vi.hoisted(() => {
	const page = {
		setContent: vi.fn(),
		evaluate: vi.fn(),
		screenshot: vi.fn(),
		close: vi.fn(),
	};
	const browser = { newPage: vi.fn(async () => page) };
	return { browser, page };
});

vi.mock("../browserPool.js", () => ({
	getScreenshotBrowser: vi.fn(async () => browserFixture.browser),
}));

import { renderHtmlScreenshotForProcessor } from "../visualVerifier.js";

describe("processor screenshot rendering", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		browserFixture.page.setContent.mockResolvedValue(undefined);
		browserFixture.page.evaluate.mockResolvedValue({
			fitsFrame: true,
			viewport: { width: 390, height: 844 },
		});
		browserFixture.page.screenshot.mockResolvedValue(Buffer.from([1, 2, 3]));
		browserFixture.page.close.mockResolvedValue(undefined);
	});

	it("returns screenshot bytes as base64 without a debug session or filesystem path", async () => {
		const result = await renderHtmlScreenshotForProcessor({
			html: "<main>processor</main>",
			fileNameBase: "variant-1-rendered",
			context: createContextFixture(),
		});

		expect(result).toMatchObject({
			path: null,
			relativePath: null,
			base64: Buffer.from([1, 2, 3]).toString("base64"),
			mediaType: "image/png",
		});
		expect(browserFixture.page.screenshot).toHaveBeenCalledWith(
			expect.not.objectContaining({ path: expect.anything() }),
		);
		expect(browserFixture.page.close).toHaveBeenCalledTimes(1);
	});
});

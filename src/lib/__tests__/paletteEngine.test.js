import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { applyPaletteToElements } from "../paletteEngine.js";
import { selectorForId } from "../selectorUtils.js";
import { finalizeSemanticElements } from "../../../server/utils/elements.js";

const PALETTE = {
	primary: "#faf8ff",
	secondary: "#ffffff",
	accent: "#fa5c7c",
	text: "#123456",
	textMuted: "#6b6478",
	onAccent: "#ffffff",
};

function createDom(html) {
	const dom = new JSDOM(html, { pretendToBeVisual: true });
	global.window = dom.window;
	global.document = dom.window.document;
	return dom;
}

function apply(elements, html, palette = PALETTE) {
	const dom = createDom(html);
	const root = dom.window.document.body;
	applyPaletteToElements(elements, palette, root);
	return { dom, root };
}

afterEach(() => {
	global.window?.close?.();
	delete global.window;
	delete global.document;
});

describe("paletteEngine semantic mapping", () => {
	it("targets .s2c-screen as the app background fallback", () => {
		expect(selectorForId("app-bg")).toContain(".s2c-screen");

		const { root } = apply(
			[
				{
					id: "app-bg",
					role: "primary",
					isText: false,
				},
			],
			'<body><div class="s2c-screen" style="background:#000"></div></body>',
		);

		expect(root.querySelector(".s2c-screen").style.backgroundColor).toBe(
			"rgb(250, 248, 255)",
		);
	});

	it("recolors CSS-styled generated app shells from semantic primary roles", () => {
		const { dom, root } = apply(
			[
				{
					id: "app-bg",
					selector: ".s2c-screen",
					selectors: [".s2c-screen"],
					role: "primary",
					isText: false,
				},
				{
					id: "header",
					selector: ".header",
					selectors: [".header"],
					role: "primary",
					isText: false,
				},
				{
					id: "bottom-nav",
					selector: ".bottom-nav",
					selectors: [".bottom-nav"],
					role: "primary",
					isText: false,
				},
			],
			`<body>
				<style>
					html, body { background: #000; }
					.s2c-screen { background: #000; }
					.header { background: #000; }
					.bottom-nav { background: #000; }
				</style>
				<div class="s2c-screen">
					<header class="header"><svg><path d="M0 0h1v1z" /></svg></header>
					<nav class="bottom-nav"><svg><path d="M0 0h1v1z" /></svg></nav>
				</div>
			</body>`,
		);

		expect(dom.window.document.documentElement.style.backgroundColor).toBe(
			"rgb(250, 248, 255)",
		);
		expect(root.style.backgroundColor).toBe("rgb(250, 248, 255)");
		expect(root.querySelector(".s2c-screen").style.backgroundColor).toBe(
			"rgb(250, 248, 255)",
		);
		expect(root.querySelector(".header").style.backgroundColor).toBe(
			"rgb(250, 248, 255)",
		);
		expect(root.querySelector(".bottom-nav").style.backgroundColor).toBe(
			"rgb(250, 248, 255)",
		);
	});

	it("includes root itself when the root matches a palette selector", () => {
		const { root } = apply(
			[
				{
					id: "app-bg",
					selector: '[data-el="app-bg"]',
					selectors: ['[data-el="app-bg"]'],
					role: "primary",
					isText: false,
				},
			],
			'<body data-el="app-bg" style="background:#000"><main></main></body>',
		);

		expect(root.style.backgroundColor).toBe("rgb(250, 248, 255)");
		expect(root.style.color).toBe("rgb(18, 52, 86)");
	});

	it("keeps server fallback app-bg selector aligned with client mapping", () => {
		const elements = finalizeSemanticElements(
			{ elements: [] },
			"<main></main>",
		);
		const appBg = elements.find((element) => element.id === "app-bg");

		expect(appBg).toEqual(
			expect.objectContaining({
				role: "primary",
				selector: expect.stringContaining(".s2c-screen"),
			}),
		);
	});

	it("applies primary CTA as filled accent with readable on-accent text", () => {
		const { root } = apply(
			[
				{
					id: "primary-cta",
					selector: '[data-palette-id="primary-cta"]',
					selectors: ['[data-palette-id="primary-cta"]'],
					role: "accent",
					isText: false,
				},
			],
			'<body><button data-palette-id="primary-cta" style="background:#000;color:#000">Go</button></body>',
		);
		const button = root.querySelector("button");

		expect(button.style.backgroundColor).toBe("rgb(250, 92, 124)");
		expect(button.style.color).toBe("rgb(255, 255, 255)");
	});

	it("uses the palette text token for text-locked elements", () => {
		const { root } = apply(
			[
				{
					id: "headline",
					selector: ".headline",
					selectors: [".headline"],
					role: "secondary",
					isText: true,
					textLocked: true,
				},
			],
			'<body><h1 class="headline" style="color:#fff">Title</h1></body>',
		);

		expect(root.querySelector(".headline").style.color).toBe("rgb(18, 52, 86)");
	});

	it("applies manual inventory overrides after broader grouped elements", () => {
		const { root } = apply(
			[
				{
					id: "manual-upgrade-button",
					selector: '[data-pe-inventory-id="pe-1"]',
					selectors: ['[data-pe-inventory-id="pe-1"]'],
					role: "primary",
					isText: false,
					source: "manual-inventory",
				},
				{
					id: "cta-group",
					selector: ".cta",
					selectors: [".cta"],
					role: "accent",
					isText: false,
					source: "ai",
				},
			],
			`<body>
				<button class="cta" data-pe-inventory-id="pe-1" style="background:#222;color:#eee">
					Upgrade
					<svg><path d="M0 0h1v1z" /></svg>
				</button>
			</body>`,
		);
		const button = root.querySelector("button");
		const iconPath = root.querySelector("path");

		expect(button.style.backgroundColor).toBe("rgb(250, 248, 255)");
		expect(button.style.color).toBe("rgb(18, 52, 86)");
		expect(iconPath.style.fill).toBe("rgb(18, 52, 86)");
	});

	it("applies custom swatch soft tint tokens instead of a flat fill", () => {
		const { root } = apply(
			[
				{
					id: "poll-option",
					selector: ".poll-option",
					selectors: [".poll-option"],
					role: "custom-1",
					isText: false,
					textLocked: false,
				},
			],
			'<body><button class="poll-option" style="background:#fff;border:1px solid #ddd;color:#111">Option</button></body>',
			{
				...PALETTE,
				customSwatches: [
					{
						id: "custom-1",
						color: "#d9c2ff",
						applicationMode: "softTintWithBorder",
						tokens: {
							background: "#f2eaff",
							border: "#b78cff",
							text: "#123456",
							icon: "#8b5cf6",
						},
					},
				],
			},
		);
		const option = root.querySelector(".poll-option");

		expect(option.style.backgroundColor).toBe("rgb(242, 234, 255)");
		expect(option.style.borderColor).toBe("rgb(183, 140, 255)");
		expect(option.style.color).toBe("rgb(18, 52, 86)");
	});

	it("repaints svg icons for transparent custom swatch targets", () => {
		const { root } = apply(
			[
				{
					id: "detail-icon",
					selector: ".detail-icon",
					selectors: [".detail-icon"],
					role: "custom-2",
					isText: false,
				},
			],
			`<body>
				<span class="detail-icon" style="background:transparent;color:#111">
					<svg><path d="M0 0h1v1z" /></svg>
				</span>
			</body>`,
			{
				...PALETTE,
				customSwatches: [
					{
						id: "custom-2",
						color: "#22c55e",
						applicationMode: "smartDefault",
						tokens: {
							background: "#dcfce7",
							border: "#22c55e",
							text: "#123456",
							icon: "#16a34a",
						},
					},
				],
			},
		);
		const icon = root.querySelector(".detail-icon");
		const path = root.querySelector("path");

		expect(icon.style.backgroundColor).toBe("transparent");
		expect(icon.style.color).toBe("rgb(22, 163, 74)");
		expect(path.style.fill).toBe("rgb(22, 163, 74)");
	});
});

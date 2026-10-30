import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildElementInventory,
	clearElementInventoryMarkers,
	INVENTORY_ID_ATTRIBUTE,
	stripElementInventoryMarkersFromHtml,
} from "../elementInventory.js";

function createDom(html) {
	const dom = new JSDOM(html, { pretendToBeVisual: true });
	global.window = dom.window;
	global.document = dom.window.document;
	return dom;
}

afterEach(() => {
	global.window?.close?.();
	delete global.window;
	delete global.document;
});

describe("element inventory", () => {
	it("builds curated inventory items with runtime selectors", () => {
		const dom = createDom(`
			<body>
				<main>
					<button style="background: rgb(17, 24, 39); color: white">Upgrade</button>
					<section class="pricing-card" style="background: rgb(255, 255, 255)">
						<h2>Pro plan</h2>
					</section>
				</main>
			</body>
		`);
		const root = dom.window.document.body;

		const inventory = buildElementInventory(root, { maxItems: 10 });

		expect(inventory).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					inventoryId: "pe-1",
					selector: `[${INVENTORY_ID_ATTRIBUTE}="pe-1"]`,
				}),
			]),
		);
		expect(inventory.some((item) => item.kind === "button")).toBe(true);
		expect(
			root.querySelector(`[${INVENTORY_ID_ATTRIBUTE}="pe-1"]`),
		).toBeTruthy();
	});

	it("keeps individual controls, icons, titles, and text inside containers", () => {
		const dom = createDom(`
			<body>
				<section class="pricing-card" style="background: rgb(255, 255, 255)">
					<h2>Pro plan</h2>
					<p>For growing teams</p>
					<button style="background: rgb(17, 24, 39); color: white">
						<svg aria-label="Sparkle icon"><path d="M0 0h1v1z" /></svg>
						Upgrade
					</button>
				</section>
			</body>
		`);
		const root = dom.window.document.body;

		const inventory = buildElementInventory(root, { maxItems: 20 });
		const kinds = inventory.map((item) => item.kind);

		expect(kinds).toEqual(
			expect.arrayContaining(["card", "title", "text", "button", "icon"]),
		);
		expect(inventory.find((item) => item.kind === "title")).toEqual(
			expect.objectContaining({
				groupLabel: "Titles",
				label: "Title: Pro plan",
			}),
		);
	});

	it("replaces previous runtime markers before rebuilding", () => {
		const dom = createDom(
			'<body><button data-pe-inventory-id="stale">Save</button></body>',
		);
		const root = dom.window.document.body;

		const inventory = buildElementInventory(root, { maxItems: 10 });

		expect(inventory[0].inventoryId).toBe("pe-1");
		expect(root.querySelector('[data-pe-inventory-id="stale"]')).toBeNull();
		expect(root.querySelector('[data-pe-inventory-id="pe-1"]')).toBeTruthy();

		clearElementInventoryMarkers(root);
		expect(root.querySelector("[data-pe-inventory-id]")).toBeNull();
	});

	it("excludes candidates hidden by ancestor styles", () => {
		const dom = createDom(`
			<body>
				<div style="display: none">
					<button>Hidden action</button>
				</div>
				<button>Visible action</button>
			</body>
		`);
		const root = dom.window.document.body;

		const inventory = buildElementInventory(root, { maxItems: 10 });

		expect(inventory.map((item) => item.label)).toEqual([
			"Button: Visible action",
		]);
	});

	it("honors item and scan caps with safe fallbacks", () => {
		const dom = createDom(`
			<body>
				<button>First</button>
				<button>Second</button>
				<button>Third</button>
			</body>
		`);
		const root = dom.window.document.body;

		expect(buildElementInventory(root, { maxItems: 2 })).toHaveLength(2);
		expect(buildElementInventory(root, { maxScanNodes: 1 })).toHaveLength(1);
		expect(buildElementInventory(root, { maxItems: -1 })).toHaveLength(3);
	});

	it("strips runtime inventory markers from serialized html", () => {
		expect(
			stripElementInventoryMarkersFromHtml(
				'<div data-pe-inventory-id="pe-1"><button data-pe-inventory-id=pe-2>Go</button></div>',
			),
		).toBe("<div><button>Go</button></div>");
	});

	it("handles empty roots and cleanup calls safely", () => {
		expect(buildElementInventory(null)).toEqual([]);
		expect(() => clearElementInventoryMarkers(null)).not.toThrow();
	});
});

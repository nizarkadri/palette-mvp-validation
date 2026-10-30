import { beforeAll, describe, expect, it } from "vitest";
import { loadModule } from "./testUtils.js";

let randomUtils;

beforeAll(async () => {
	randomUtils = await loadModule("../random.js");
});

describe("colorBrain deterministic random utilities", () => {
	it("creates reproducible random sequences from the same seed", () => {
		const first = randomUtils.seededRandom("same-seed");
		const second = randomUtils.seededRandom("same-seed");

		expect(Array.from({ length: 8 }, () => first())).toEqual(
			Array.from({ length: 8 }, () => second()),
		);
	});

	it("creates different sequences for different seeds", () => {
		const first = randomUtils.seededRandom("seed-a");
		const second = randomUtils.seededRandom("seed-b");

		expect(Array.from({ length: 8 }, () => first())).not.toEqual(
			Array.from({ length: 8 }, () => second()),
		);
	});

	it("picks weighted values and respects zero-weight items", () => {
		const random = () => 0.1;
		const picked = randomUtils.pickWeighted(
			[
				{ value: "never", weight: 0 },
				{ value: "often", weight: 10 },
			],
			random,
		);

		expect(picked).toBe("often");
	});

	it("shuffles without mutating the original input", () => {
		const input = [1, 2, 3, 4, 5];
		const shuffled = randomUtils.shuffle(
			input,
			randomUtils.seededRandom("shuffle"),
		);

		expect(input).toEqual([1, 2, 3, 4, 5]);
		expect([...shuffled].sort()).toEqual(input);
	});
});

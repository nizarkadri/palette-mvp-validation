export function createPaletteQueue({
	initialPalettes = [],
	lowWatermark = 24,
	refill,
} = {}) {
	let palettes = [...initialPalettes];
	let cursor = 0;
	let isRefilling = false;

	function remainingBeforeLoop() {
		if (palettes.length === 0) return 0;
		return palettes.length - (cursor % palettes.length);
	}

	function maybeRefill() {
		if (isRefilling || typeof refill !== "function") return;
		if (remainingBeforeLoop() > lowWatermark) return;

		isRefilling = true;
		Promise.resolve(refill())
			.then((nextPalettes) => {
				if (Array.isArray(nextPalettes) && nextPalettes.length > 0) {
					palettes = [...palettes, ...nextPalettes];
				}
			})
			.finally(() => {
				isRefilling = false;
			});
	}

	return {
		next() {
			if (palettes.length === 0) {
				maybeRefill();
				return null;
			}

			const palette = palettes[cursor % palettes.length];
			cursor += 1;
			maybeRefill();
			return palette;
		},
		size() {
			return remainingBeforeLoop();
		},
		all() {
			return [...palettes];
		},
		append(nextPalettes) {
			if (Array.isArray(nextPalettes) && nextPalettes.length > 0) {
				palettes = [...palettes, ...nextPalettes];
			}
		},
	};
}

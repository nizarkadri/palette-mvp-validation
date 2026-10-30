function cyrb128(value) {
	let h1 = 1779033703;
	let h2 = 3144134277;
	let h3 = 1013904242;
	let h4 = 2773480762;

	for (let index = 0; index < value.length; index += 1) {
		const key = value.charCodeAt(index);
		h1 = h2 ^ Math.imul(h1 ^ key, 597399067);
		h2 = h3 ^ Math.imul(h2 ^ key, 2869860233);
		h3 = h4 ^ Math.imul(h3 ^ key, 951274213);
		h4 = h1 ^ Math.imul(h4 ^ key, 2716044179);
	}

	h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
	h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
	h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
	h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);

	return [
		(h1 ^ h2 ^ h3 ^ h4) >>> 0,
		(h2 ^ h1) >>> 0,
		(h3 ^ h1) >>> 0,
		(h4 ^ h1) >>> 0,
	];
}

function sfc32(a, b, c, d) {
	return () => {
		a >>>= 0;
		b >>>= 0;
		c >>>= 0;
		d >>>= 0;
		const t = (((a + b) | 0) + d) | 0;
		d = (d + 1) | 0;
		a = b ^ (b >>> 9);
		b = (c + (c << 3)) | 0;
		c = (c << 21) | (c >>> 11);
		c = (c + t) | 0;
		return (t >>> 0) / 4294967296;
	};
}

export function seededRandom(seed = "colorBrain") {
	return sfc32(...cyrb128(String(seed)));
}

export function randomBetween(min, max, random = Math.random) {
	return min + (max - min) * random();
}

export function pickWeighted(items, random = Math.random) {
	if (!Array.isArray(items) || items.length === 0) return undefined;

	const totalWeight = items.reduce(
		(sum, item) => sum + Math.max(0, item.weight ?? 1),
		0,
	);
	if (totalWeight <= 0) return items[0].value ?? items[0];

	let cursor = random() * totalWeight;
	for (const item of items) {
		cursor -= Math.max(0, item.weight ?? 1);
		if (cursor <= 0) return item.value ?? item;
	}

	const last = items[items.length - 1];
	return last.value ?? last;
}

export function shuffle(items, random = Math.random) {
	const result = [...items];
	for (let index = result.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(random() * (index + 1));
		[result[index], result[swapIndex]] = [result[swapIndex], result[index]];
	}
	return result;
}

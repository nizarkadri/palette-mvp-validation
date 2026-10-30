import { Fragment, useState } from "react";
import {
	hexToRgbColor,
	mixHexColors,
	rgbToHexColor,
} from "../lib/colorUtils.js";

/**
 * PaletteStrip
 * ------------
 * Persistent palette dock. It preserves palette cycling, role locks, and
 * lightweight swatch editing while presenting the current colors as a
 * full-width control surface.
 */
const ROLE_SWATCHES = [
	// Legacy palette keys map to the stable visible colorBrain roles.
	{ key: "primary", label: "Background", lockable: true, required: true },
	{ key: "secondary", label: "Surface", lockable: true, required: true },
	{ key: "accent", label: "Accent", lockable: true, required: true },
	{ key: "text", label: "Text", lockable: true, required: false },
	{ key: "textMuted", label: "Muted", lockable: true, required: false },
];

const MIN_SWATCHES = 3;
const MAX_SWATCHES = 7;

function readableTextColor(hex) {
	const rgb = hexToRgbColor(hex);
	if (!rgb) return "#ffffff";
	const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
	return luminance > 0.62 ? "#1f1d1a" : "#ffffff";
}

function boostSuggestedColor(hex) {
	const rgb = hexToRgbColor(hex);
	if (!rgb) return "#888888";
	const max = Math.max(rgb.r, rgb.g, rgb.b);
	const min = Math.min(rgb.r, rgb.g, rgb.b);
	const contrast = max - min;
	const lift = contrast < 34 ? 34 : 18;

	return rgbToHexColor({
		r: rgb.r === max ? rgb.r + lift : rgb.r - lift * 0.25,
		g: rgb.g === max ? rgb.g + lift : rgb.g - lift * 0.25,
		b: rgb.b === max ? rgb.b + lift : rgb.b - lift * 0.25,
	});
}

function suggestSwatchColor(swatches, index) {
	const current = swatches[index];
	const next = swatches[index + 1];
	const mixed = mixHexColors(current?.color, next?.color, 0.5);
	return boostSuggestedColor(mixed);
}

function arrangeSwatches(roleSwatches, customSwatches) {
	const customByAnchor = new Map();
	const arranged = [];
	const emitted = new Set();

	customSwatches.forEach((swatch) => {
		const anchorKey = swatch.insertAfterKey || "__end__";
		const bucket = customByAnchor.get(anchorKey) || [];
		bucket.push({
			...swatch,
			key: swatch.id,
			lockable: true,
			required: false,
			custom: true,
		});
		customByAnchor.set(anchorKey, bucket);
	});

	function appendWithChildren(swatch) {
		if (emitted.has(swatch.key)) return;
		emitted.add(swatch.key);
		arranged.push(swatch);
		(customByAnchor.get(swatch.key) || []).forEach(appendWithChildren);
	}

	roleSwatches.forEach(appendWithChildren);
	customSwatches
		.filter((swatch) => !emitted.has(swatch.id))
		.forEach((swatch) =>
			appendWithChildren({
				...swatch,
				key: swatch.id,
				lockable: true,
				required: false,
				custom: true,
			}),
		);

	return arranged;
}

export default function PaletteStrip({
	palette,
	lockedRoles = {},
	customSwatches = [],
	hiddenSwatches = [],
	onToggleRoleLock,
	onAddSwatch,
	onDeleteSwatch,
}) {
	const [copiedKey, setCopiedKey] = useState(null);

	function copyColor(event, key, color) {
		event.stopPropagation();
		navigator.clipboard?.writeText(color).then(() => {
			setCopiedKey(key);
			window.setTimeout(() => setCopiedKey(null), 1200);
		});
	}

	function addSuggestedSwatch(insertAfterKey, swatches, index) {
		const suggestedColor = suggestSwatchColor(swatches, index);
		onAddSwatch?.(suggestedColor, insertAfterKey);
	}

	const hiddenSwatchSet = new Set(hiddenSwatches);
	const roleSwatches = ROLE_SWATCHES.map((swatch) => ({
		...swatch,
		color: palette?.[swatch.key],
	})).filter((swatch) => swatch.color && !hiddenSwatchSet.has(swatch.key));
	const swatches = arrangeSwatches(roleSwatches, customSwatches);
	const canAddSwatch = swatches.length < MAX_SWATCHES;
	const canDeleteSwatch = swatches.length > MIN_SWATCHES;

	return (
		<div className="palette-strip-wrap">
			<div className="palette-strip" aria-label="Current palette colors">
				{swatches.map((swatch, index) => {
					const isLocked = Boolean(lockedRoles[swatch.key]);
					const textColor = readableTextColor(swatch.color);
					const isCopied = copiedKey === swatch.key;
					const canDeleteThis = !swatch.required && canDeleteSwatch;
					const canInsertAfterThis =
						canAddSwatch && index < swatches.length - 1;

					return (
						<Fragment key={swatch.key}>
							<div
								className={`palette-swatch ${isLocked ? "locked" : ""}`}
								style={{ background: swatch.color, color: textColor }}
								title={`${swatch.label}: ${swatch.color}`}
							>
								<span className="palette-swatch-label">{swatch.label}</span>
								<span className="palette-swatch-value">
									{isCopied ? "Copied" : swatch.color}
								</span>
								<div className="palette-swatch-actions">
									<button
										type="button"
										className={`palette-icon-btn palette-copy-btn ${isCopied ? "copied" : ""}`}
										aria-label={`Copy ${swatch.label.toLowerCase()} color ${swatch.color}`}
										onClick={(event) =>
											copyColor(event, swatch.key, swatch.color)
										}
									>
										<i
											className={`ti ${isCopied ? "ti-check" : "ti-copy"}`}
											aria-hidden="true"
										/>
									</button>
									{swatch.lockable && (
										<button
											type="button"
											className="palette-icon-btn palette-lock-btn"
											aria-label={`${isLocked ? "Unlock" : "Lock"} ${swatch.label.toLowerCase()} color`}
											aria-pressed={isLocked}
											onClick={(event) => {
												event.stopPropagation();
												onToggleRoleLock?.(swatch.key);
											}}
										>
											<i
												className={`ti ${isLocked ? "ti-lock" : "ti-lock-open"}`}
												aria-hidden="true"
											/>
										</button>
									)}
									{canDeleteThis && (
										<button
											type="button"
											className="palette-icon-btn palette-delete-btn"
											aria-label={`Delete ${swatch.label.toLowerCase()} swatch`}
											onClick={(event) => {
												event.stopPropagation();
												onDeleteSwatch?.(swatch.key);
											}}
										>
											<i className="ti ti-trash" aria-hidden="true" />
										</button>
									)}
								</div>
							</div>
							{canInsertAfterThis && (
								<div className="palette-insert-slot">
									<button
										type="button"
										className="palette-insert-btn"
										onClick={() =>
											addSuggestedSwatch(swatch.key, swatches, index)
										}
										aria-label={`Add suggested swatch after ${swatch.label.toLowerCase()}`}
										title="Add suggested swatch"
									>
										<i className="ti ti-plus" aria-hidden="true" />
									</button>
								</div>
							)}
						</Fragment>
					);
				})}
			</div>
		</div>
	);
}

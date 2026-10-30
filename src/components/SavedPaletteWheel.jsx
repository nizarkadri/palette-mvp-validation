import { useState } from "react";

const MAX_ORBIT_PALETTES = 8;
const CX = 200;
const CY = 200;
const CENTER_R = 52;
const GAP_DEG = 3.5;
const SEG_DEG = 360 / MAX_ORBIT_PALETTES;

const RINGS = [
	{ inner: 60, outer: 97 },
	{ inner: 101, outer: 136 },
	{ inner: 140, outer: 173 },
];

function getPreviewColors(savedPalette) {
	const palette = savedPalette?.palette || {};
	return [palette.primary, palette.secondary, palette.accent].filter(Boolean);
}

function polar(radius, angleInDegrees) {
	const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
	return [
		CX + radius * Math.cos(angleInRadians),
		CY + radius * Math.sin(angleInRadians),
	];
}

function annularSlice(inner, outer, start, end, cornerRadius = 6) {
	const outerArcOffset = (cornerRadius / outer) * (180 / Math.PI);
	const innerArcOffset = (cornerRadius / inner) * (180 / Math.PI);
	const largeArcFlag = end - start > 180 ? 1 : 0;
	const point = (radius, angle) => polar(radius, angle).join(",");

	return [
		`M ${point(outer, start + outerArcOffset)}`,
		`A ${outer} ${outer} 0 ${largeArcFlag} 1 ${point(
			outer,
			end - outerArcOffset,
		)}`,
		`Q ${point(outer, end)} ${point(outer - cornerRadius, end)}`,
		`L ${point(inner + cornerRadius, end)}`,
		`Q ${point(inner, end)} ${point(inner, end - innerArcOffset)}`,
		`A ${inner} ${inner} 0 ${largeArcFlag} 0 ${point(
			inner,
			start + innerArcOffset,
		)}`,
		`Q ${point(inner, start)} ${point(inner + cornerRadius, start)}`,
		`L ${point(outer - cornerRadius, start)}`,
		`Q ${point(outer, start)} ${point(outer, start + outerArcOffset)}`,
		"Z",
	].join(" ");
}

function normalizeHex(color) {
	if (typeof color !== "string") {
		return null;
	}

	const trimmed = color.trim();
	const shortHexMatch = trimmed.match(/^#([\da-f]{3})$/i);
	if (shortHexMatch) {
		return `#${shortHexMatch[1]
			.split("")
			.map((character) => character + character)
			.join("")}`;
	}

	return /^#[\da-f]{6}$/i.test(trimmed) ? trimmed : null;
}

function mixHex(color, mixColor = "#f8f1ea", amount = 0.5) {
	const normalizedColor = normalizeHex(color);
	const normalizedMix = normalizeHex(mixColor);

	if (!normalizedColor || !normalizedMix) {
		return color;
	}

	const hexToRgb = (hex) => ({
		r: Number.parseInt(hex.slice(1, 3), 16),
		g: Number.parseInt(hex.slice(3, 5), 16),
		b: Number.parseInt(hex.slice(5, 7), 16),
	});
	const colorRgb = hexToRgb(normalizedColor);
	const mixRgb = hexToRgb(normalizedMix);
	const channelToHex = (channel) => channel.toString(16).padStart(2, "0");
	const mixed = ["r", "g", "b"].map((channel) =>
		Math.round(colorRgb[channel] * (1 - amount) + mixRgb[channel] * amount),
	);

	return `#${mixed.map(channelToHex).join("")}`;
}

function getConeColors(savedPalette) {
	const [primary, secondary, accent] = getPreviewColors(savedPalette);
	const base = primary || secondary || accent || "#757575";
	return [
		primary || mixHex(base, "#ffffff", 0.62),
		secondary || mixHex(base, "#ffffff", 0.28),
		accent || base,
	];
}

function withHexAlpha(color, alpha) {
	const normalized = normalizeHex(color);
	return normalized ? `${normalized}${alpha}` : color;
}

function createCone(savedPalette, index) {
	const colors = getConeColors(savedPalette);
	const startAngle = index * SEG_DEG + GAP_DEG;
	const endAngle = (index + 1) * SEG_DEG - GAP_DEG;

	return RINGS.map((ring, ringIndex) => ({
		d: annularSlice(ring.inner, ring.outer, startAngle, endAngle),
		color: colors[ringIndex] || colors[0],
	}));
}

function getConeLiftTransform(index, amount) {
	if (!amount) return "translate(0, 0)";

	const angleInRadians = (((index + 0.5) * SEG_DEG - 90) * Math.PI) / 180;
	const x = Math.cos(angleInRadians) * amount;
	const y = Math.sin(angleInRadians) * amount;

	return `translate(${x}px, ${y}px)`;
}

function createConicGlow(savedPalettes) {
	const segments = savedPalettes.map((savedPalette, index) => {
		const colors = getConeColors(savedPalette);
		const accentColor = colors[2] || colors[1] || colors[0];
		return `${accentColor} ${index * SEG_DEG}deg ${(index + 1) * SEG_DEG}deg`;
	});

	if (!segments.length) {
		return `conic-gradient(from -90deg, #ff6b35 0deg 45deg, #00acc1 45deg 90deg, #7cb342 90deg 135deg, #8e24aa 135deg 180deg, #d81b60 180deg 225deg, #3949ab 225deg 270deg, #ffb300 270deg 315deg, #757575 315deg 360deg)`;
	}

	if (segments.length < MAX_ORBIT_PALETTES) {
		segments.push(
			`transparent ${segments.length * SEG_DEG}deg ${
				MAX_ORBIT_PALETTES * SEG_DEG
			}deg`,
		);
	}

	return `conic-gradient(from -90deg, ${segments.join(", ")})`;
}

export default function SavedPaletteWheel({
	savedPalettes = [],
	isSaved = false,
	currentPaletteSignature = null,
	onToggleSavedPalette,
	onApplySavedPalette,
}) {
	const [hoveredPaletteId, setHoveredPaletteId] = useState(null);
	const selectedSavedPalette = currentPaletteSignature
		? savedPalettes.find(
				(savedPalette) => savedPalette.signature === currentPaletteSignature,
			) || null
		: null;
	const selectedPaletteId = selectedSavedPalette?.id || null;
	const baseOrbitPalettes = savedPalettes.slice(0, MAX_ORBIT_PALETTES);
	const orbitPalettes =
		selectedSavedPalette &&
		!baseOrbitPalettes.some(
			(savedPalette) => savedPalette.id === selectedSavedPalette.id,
		)
			? [
					...baseOrbitPalettes.slice(0, MAX_ORBIT_PALETTES - 1),
					selectedSavedPalette,
				]
			: baseOrbitPalettes;
	const hoveredPalette =
		orbitPalettes.find(
			(savedPalette) => savedPalette.id === hoveredPaletteId,
		) || null;
	const activePalette =
		hoveredPalette ||
		orbitPalettes.find(
			(savedPalette) => savedPalette.id === selectedPaletteId,
		) ||
		null;
	const centerFill = activePalette
		? getConeColors(activePalette)[1]
		: "rgba(0,0,0,0.08)";
	const favoriteTooltip = isSaved ? "Remove" : "Add";
	const wheelStyle = {
		"--wheel-conic-glow": createConicGlow(orbitPalettes),
	};

	return (
		<div
			className="saved-palette-wheel"
			style={wheelStyle}
			onMouseLeave={() => setHoveredPaletteId(null)}
		>
			<div
				className="saved-palette-wheel-orbit"
				aria-label="Saved palette wheel"
			>
				<svg
					className="saved-palette-wheel-rings"
					viewBox="0 0 400 400"
					aria-label="Saved palette preview slices"
				>
					<circle
						cx={CX}
						cy={CY}
						r="178"
						fill="none"
						stroke="rgba(255,255,255,0.04)"
						strokeWidth="2"
					/>
					{orbitPalettes.map((savedPalette, index) => {
						const cone = createCone(savedPalette, index);
						const isHovered = hoveredPaletteId === savedPalette.id;
						const isSelected = selectedPaletteId === savedPalette.id;
						const isHighlighted = isHovered || isSelected;
						let liftAmount = 0;
						if (isSelected) {
							liftAmount = isHovered ? 14 : 10;
						} else if (isHovered) {
							liftAmount = 6;
						}
						let ringOpacity = 0.75;
						if (isSelected) {
							ringOpacity = 1;
						} else if (isHovered) {
							ringOpacity = 0.92;
						}
						const coneColors = getConeColors(savedPalette);
						const glowColor = coneColors[2] || coneColors[1] || coneColors[0];
						const coneGlow = isHighlighted
							? `drop-shadow(0 0 10px ${withHexAlpha(glowColor, "99")}) brightness(1.1)`
							: `drop-shadow(0 0 5px ${withHexAlpha(glowColor, "33")})`;
						return (
							<g
								key={savedPalette.id}
								className={`saved-palette-wheel-cone ${isSelected ? "selected" : ""}`}
								role="button"
								tabIndex={0}
								style={{
									transform: getConeLiftTransform(index, liftAmount),
									transformOrigin: `${CX}px ${CY}px`,
								}}
								aria-current={isSelected ? "true" : undefined}
								onMouseEnter={() => setHoveredPaletteId(savedPalette.id)}
								onMouseLeave={() => setHoveredPaletteId(null)}
								onFocus={() => setHoveredPaletteId(savedPalette.id)}
								onBlur={() => setHoveredPaletteId(null)}
								onClick={() => onApplySavedPalette?.(savedPalette)}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										onApplySavedPalette?.(savedPalette);
									}
								}}
								aria-label={`Apply ${savedPalette.name}`}
							>
								{cone.map((ring, ringIndex) => (
									<path
										key={`${savedPalette.id}-${ringIndex}`}
										className="saved-palette-wheel-cone-ring"
										d={ring.d}
										fill={ring.color}
										stroke="rgba(255,255,255,0.35)"
										strokeWidth="1.5"
										style={{
											opacity: ringOpacity,
											filter: coneGlow,
										}}
									/>
								))}
							</g>
						);
					})}
					<circle cx={CX} cy={CY} r={CENTER_R + 6} fill="transparent" />
					<circle
						cx={CX}
						cy={CY}
						r={CENTER_R}
						fill={centerFill}
						style={{ transition: "fill 0.4s ease" }}
					/>
					<circle
						cx={CX}
						cy={CY}
						r={CENTER_R}
						fill="none"
						stroke="rgba(0,0,0,0.12)"
						strokeWidth="1.5"
					/>
				</svg>
				<button
					type="button"
					className={`saved-palette-wheel-heart ${isSaved ? "saved" : ""}`}
					onClick={onToggleSavedPalette}
					aria-pressed={isSaved}
					aria-label={favoriteTooltip}
					data-tooltip={favoriteTooltip}
				>
					<i
						className={`ti ${isSaved ? "ti-heart-filled" : "ti-heart"}`}
						aria-hidden="true"
					/>
				</button>
			</div>
		</div>
	);
}

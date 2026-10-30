const CREATIVITY_OPTIONS = [
	{ value: "safe", label: "Safe" },
	{ value: "balanced", label: "Balanced" },
	{ value: "expressive", label: "Expressive" },
	{ value: "wild", label: "Wild" },
];

const THEME_OPTIONS = [
	{ value: "auto", label: "Auto" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];

export default function ColorBrainControls({
	settings,
	palette,
	isGeneratingMore = false,
	generationMessage = "",
	generationStatus = "idle",
	onChangeSetting,
	onGenerateMore,
}) {
	const colorBrain = palette?._colorBrain;
	const score = colorBrain?.score?.total;
	const note = colorBrain?.notes?.[0] || "Adapted for readable UI.";

	return (
		<div className="colorbrain-controls" aria-label="colorBrain controls">
			<div className="colorbrain-controls-heading">
				<span>colorBrain</span>
				<strong>{score ? `Score ${score}` : "Palette style"}</strong>
			</div>

			<label className="colorbrain-field">
				<span>Creativity</span>
				<select
					value={settings.creativity}
					disabled={isGeneratingMore}
					onChange={(event) =>
						onChangeSetting("creativity", event.target.value)
					}
				>
					{CREATIVITY_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</label>

			<label className="colorbrain-field">
				<span>Theme</span>
				<select
					value={settings.theme}
					disabled={isGeneratingMore}
					onChange={(event) => onChangeSetting("theme", event.target.value)}
				>
					{THEME_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</label>

			<button
				type="button"
				className="colorbrain-button primary"
				onClick={onGenerateMore}
				disabled={isGeneratingMore}
			>
				{isGeneratingMore ? "Generating..." : "Generate more"}
			</button>

			{generationMessage && (
				<p
					className={`colorbrain-generation-note ${generationStatus}`}
					aria-live="polite"
				>
					{generationMessage}
				</p>
			)}

			<p className="colorbrain-note">{note}</p>
		</div>
	);
}

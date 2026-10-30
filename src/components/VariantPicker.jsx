import { useMemo, useRef, useState } from "react";
import UiPreview from "./UiPreview.jsx";

export function getImageSrc(image) {
	if (!image) return null;
	if (typeof image === "string") {
		if (image.startsWith("data:") || image.startsWith("http")) return image;
		if (
			image.includes("/") ||
			image.endsWith(".png") ||
			image.endsWith(".jpg")
		) {
			return image.startsWith("/") ? image : `/${image}`;
		}
		return `data:image/png;base64,${image}`;
	}
	if (image.base64) {
		return `data:${image.mediaType || "image/png"};base64,${image.base64}`;
	}
	if (image.relativePath) {
		return image.relativePath.startsWith("/")
			? image.relativePath
			: `/${image.relativePath}`;
	}
	return null;
}

export default function VariantPicker({
	variants,
	selectedVariantId,
	recommendedVariantId,
	isGenerating,
	isCategorizing,
	progressPercent = 0,
	previewMode = "desktop",
	onPreviewModeChange,
	onSelectVariant,
	onUseSelectedVariant,
	onImproveVariant,
	uploadedImage,
	onFileSelected,
	improvingVariantId = null,
	highlightedVariantId = null,
}) {
	const previewRootRef = useRef(null);
	const fileInputRef = useRef(null);
	const [previewVariantId, setPreviewVariantId] = useState(null);
	const selectedVariant = useMemo(
		() => variants.find((variant) => variant.id === selectedVariantId) || null,
		[variants, selectedVariantId],
	);
	const previewVariant = useMemo(
		() => variants.find((variant) => variant.id === previewVariantId) || null,
		[variants, previewVariantId],
	);
	const safeProgress = Math.max(0, Math.min(100, Math.round(progressPercent)));
	const uploadedImageSrc = getImageSrc(uploadedImage);
	const isImprovingAnyVariant = Boolean(improvingVariantId);
	const canContinue =
		Boolean(selectedVariant) && !isCategorizing && !isImprovingAnyVariant;
	const canContinueFromPreview =
		Boolean(previewVariant) && !isCategorizing && !isImprovingAnyVariant;

	function handleReplacementUpload(event) {
		const [file] = event.target.files || [];
		if (file) onFileSelected?.(file);
		event.target.value = "";
	}

	function selectVariant(variantId) {
		onSelectVariant?.(variantId);
		setPreviewVariantId(null);
	}

	function previewVariantById(variantId) {
		onSelectVariant?.(variantId);
		setPreviewVariantId(variantId);
	}

	function improveVariantById(variantId) {
		onImproveVariant?.(variantId);
	}

	return (
		<div className="variant-picker">
			<div className="variant-selection-copy">
				<p className="eyebrow">Step 1 of 2</p>
				<h2>Pick the closest layout</h2>
				<p>
					Choose the variant that best matches your screenshot. We&apos;ll use
					it to map extracted colors to the right grouped elements.
				</p>
			</div>

			<div className="variant-reference-row">
				<div className="uploaded-shot-card">
					{uploadedImageSrc ? (
						<img src={uploadedImageSrc} alt="Uploaded screenshot preview" />
					) : (
						<span className="uploaded-shot-placeholder" aria-hidden="true">
							<i className="ti ti-photo" />
						</span>
					)}
					<div>
						<strong>{uploadedImage?.name || "Current screenshot"}</strong>
						<span>Uploaded</span>
					</div>
				</div>

				<span className="variant-reference-or">or</span>

				<button
					type="button"
					className="variant-upload-button"
					onClick={() => fileInputRef.current?.click()}
					disabled={isGenerating || isCategorizing || isImprovingAnyVariant}
				>
					<i className="ti ti-upload" aria-hidden="true" />
					Upload new screenshot
				</button>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/*"
					className="visually-hidden"
					onChange={handleReplacementUpload}
				/>
			</div>

			<div className="variant-tabs" aria-label="Generated layout variants">
				{variants.map((variant, displayIndex) => {
					const isActive = variant.id === selectedVariantId;
					const isImproving = improvingVariantId === variant.id;
					const isHighlighted = highlightedVariantId === variant.id;
					const thumbnailSrc = getImageSrc(variant.renderedScreenshot);
					const parentDisplayIndex = variant.parentVariantId
						? variants.findIndex(
								(item) => item.id === variant.parentVariantId,
							) + 1
						: 0;
					const cardClassName = [
						"variant-card",
						isActive ? "active" : "",
						variant.isImproved ? "improved" : "",
						isHighlighted ? "highlighted" : "",
					]
						.filter(Boolean)
						.join(" ");
					return (
						<div
							key={variant.id}
							className={cardClassName}
							role="group"
							aria-label={`Variant ${displayIndex + 1}`}
						>
							<span className="variant-thumb">
								{thumbnailSrc ? (
									<img src={thumbnailSrc} alt="" aria-hidden="true" />
								) : (
									<i className="ti ti-layout-dashboard" aria-hidden="true" />
								)}
								{isActive && (
									<span className="variant-selected-check" aria-hidden="true">
										<i className="ti ti-check" />
									</span>
								)}
								<span className="variant-card-actions">
									<button
										type="button"
										className="variant-card-action"
										onClick={() => previewVariantById(variant.id)}
									>
										Preview
									</button>
									<button
										type="button"
										className="variant-card-action primary"
										onClick={() => selectVariant(variant.id)}
									>
										Select
									</button>
									<button
										type="button"
										className="variant-card-action"
										onClick={() => improveVariantById(variant.id)}
										disabled={
											isGenerating || isCategorizing || isImprovingAnyVariant
										}
									>
										{isImproving ? "Improving..." : "Improve"}
									</button>
								</span>
							</span>
							<span className="variant-card-title">
								Variant {displayIndex + 1}
							</span>
							<span className="variant-card-meta-row">
								{variant.isImproved && (
									<span className="variant-badge improved">
										Improved
										{parentDisplayIndex > 0
											? ` from Variant ${parentDisplayIndex}`
											: ""}
									</span>
								)}
								{variant.id === recommendedVariantId && (
									<span className="variant-badge">Recommended</span>
								)}
								{variant.issues?.length > 0 && (
									<span className="variant-warning">
										{variant.issues.length} issue
										{variant.issues.length === 1 ? "" : "s"}
									</span>
								)}
							</span>
						</div>
					);
				})}
				{isGenerating && variants.length < 3 && (
					<div className="variant-card ghost" aria-live="polite">
						<span className="spinner" />
						<span>Generating more...</span>
					</div>
				)}
			</div>

			{previewVariant && (
				<div
					className={`variant-preview-layer ${previewMode}`}
					onMouseLeave={() => setPreviewVariantId(null)}
				>
					<div className="variant-preview-popover">
						<div className="variant-preview-popover-header">
							<span>Preview layout</span>
							<button
								type="button"
								className="variant-preview-close"
								onClick={() => setPreviewVariantId(null)}
								aria-label="Close variant preview"
							>
								<i className="ti ti-x" aria-hidden="true" />
							</button>
						</div>
						<UiPreview
							html={previewVariant.html}
							containerRef={previewRootRef}
							previewMode={previewMode}
							onPreviewModeChange={onPreviewModeChange}
						/>
					</div>
					<button
						type="button"
						className="variant-preview-continue"
						onClick={onUseSelectedVariant}
						disabled={!canContinueFromPreview}
					>
						{isCategorizing ? "Mapping groups..." : "Continue with this layout"}
					</button>
				</div>
			)}

			<div className="variant-actions">
				<div className="upload-progress variant-progress" aria-hidden="true">
					<div className="upload-progress-track">
						<div
							className="upload-progress-fill"
							style={{ width: `${safeProgress}%` }}
						/>
					</div>
				</div>
				<button
					type="button"
					className="variant-use-button"
					onClick={onUseSelectedVariant}
					disabled={!canContinue}
				>
					{isCategorizing ? "Mapping groups..." : "Continue"}
				</button>
			</div>
			<p className="variant-final-note">
				After continuing, this layout becomes your editable workspace. To try
				another layout later, upload a new screenshot.
			</p>
		</div>
	);
}

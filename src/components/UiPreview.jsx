import { useEffect, useRef, useState } from "react";
import {
	buildElementInventory,
	clearElementInventoryMarkers,
} from "../lib/elementInventory.js";
import { getElementMatches } from "../lib/paletteEngine.js";

const BLOCKED_PREVIEW_ACTIVATION_EVENTS = [
	"pointerdown",
	"mousedown",
	"click",
	"auxclick",
];

function blockPreviewActivation(event, restoreParentFocus) {
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation?.();
	restoreParentFocus?.();
}

function installPreviewInteractionGuard(document, restoreParentFocus) {
	if (!document || document.__pePreviewInteractionGuardInstalled) return;
	const block = (event) => blockPreviewActivation(event, restoreParentFocus);
	BLOCKED_PREVIEW_ACTIVATION_EVENTS.forEach((eventName) => {
		document.addEventListener(eventName, block, true);
	});
	document.addEventListener("submit", block, true);
	document.__pePreviewInteractionGuardInstalled = true;
}

function preparePreviewDocument(html) {
	const noScrollStyle = `
<style id="pe-preview-fit-style">
	html, body {
		width: 100%;
		height: 100%;
		margin: 0;
		overflow: hidden !important;
	}
	body {
		background: transparent;
		display: flex;
		align-items: flex-start;
		justify-content: center;
	}
	.s2c-screen {
		width: 100%;
		min-height: 100%;
		transform-origin: top center;
	}
	*, *::before, *::after { box-sizing: border-box; }
</style>`;

	const content = String(html || "");
	if (/<head\b[^>]*>/i.test(content)) {
		return content.replace(/<head\b([^>]*)>/i, `<head$1>${noScrollStyle}`);
	}
	if (/<html\b/i.test(content)) return content;
	return `<!doctype html><html><head><meta charset="utf-8">${noScrollStyle}</head><body>${content}</body></html>`;
}

/**
 * UiPreview
 * ---------
 * Renders screenshot-to-code output as responsive website HTML in an iframe.
 * The mobile/desktop toggle only changes the preview viewport; it never asks AI
 * to regenerate and it does not add a phone/device frame around the result.
 */
export default function UiPreview({
	html,
	containerRef,
	highlightedElement,
	previewMode = "desktop",
	onPreviewModeChange,
	onInventoryChange,
	showToolbar = true,
}) {
	const iframeRef = useRef(null);
	const previewWorkspaceRef = useRef(null);
	const [loadTick, setLoadTick] = useState(0);
	const preparedHtml = preparePreviewDocument(html);

	function applyPreviewFit() {
		const document = iframeRef.current?.contentDocument;
		if (!document?.body) return;

		const screen = document.querySelector(".s2c-screen") || document.body;
		screen.style.transform = "none";

		const viewportWidth = document.documentElement.clientWidth;
		const viewportHeight = document.documentElement.clientHeight;
		const rect = screen.getBoundingClientRect();
		const contentWidth = Math.max(screen.scrollWidth, Math.ceil(rect.width));
		const contentHeight = Math.max(screen.scrollHeight, Math.ceil(rect.height));
		const scale = Math.min(
			1,
			viewportWidth > 0 && contentWidth > 0 ? viewportWidth / contentWidth : 1,
			viewportHeight > 0 && contentHeight > 0
				? viewportHeight / contentHeight
				: 1,
		);

		screen.style.transformOrigin = "top center";
		screen.style.transform = scale < 0.999 ? `scale(${scale})` : "none";
		document.documentElement.dataset.peFitScale = scale.toFixed(4);
	}

	useEffect(() => {
		const root = containerRef.current;
		if (!root) return;

		root.querySelectorAll(".pe-highlight").forEach((el) => {
			el.classList.remove("pe-highlight");
		});

		if (highlightedElement) {
			getElementMatches(highlightedElement, root).forEach((el) => {
				el.classList.add("pe-highlight");
			});
		}
	}, [highlightedElement, containerRef, loadTick]);

	useEffect(() => {
		const iframe = iframeRef.current;
		if (!iframe || typeof ResizeObserver === "undefined") return undefined;

		const observer = new ResizeObserver(() => applyPreviewFit());
		observer.observe(iframe);
		applyPreviewFit();
		return () => observer.disconnect();
	}, [loadTick, previewMode]);

	useEffect(() => {
		return () => {
			clearElementInventoryMarkers(containerRef.current);
			onInventoryChange?.([]);
		};
	}, [containerRef, onInventoryChange, preparedHtml]);

	function restoreParentFocus() {
		window.focus();
		window.requestAnimationFrame(() => {
			previewWorkspaceRef.current?.focus({ preventScroll: true });
		});
	}

	function handleLoad() {
		const document = iframeRef.current?.contentDocument;
		if (document && !document.getElementById("pe-highlight-style")) {
			const style = document.createElement("style");
			style.id = "pe-highlight-style";
			style.textContent =
				".pe-highlight{outline:2px solid #8b6fff!important;outline-offset:2px!important;box-shadow:0 0 0 4px rgba(139,111,255,.22)!important;}";
			document.head.appendChild(style);
		}
		if (document) {
			installPreviewInteractionGuard(document, restoreParentFocus);
			document.documentElement.style.overflow = "hidden";
			document.body.style.overflow = "hidden";
			document.body.style.margin = "0";
			window.requestAnimationFrame(() => applyPreviewFit());
		}
		const previewRoot = document?.body || document?.documentElement || null;
		containerRef.current = previewRoot;
		onInventoryChange?.(previewRoot ? buildElementInventory(previewRoot) : []);
		setLoadTick((tick) => tick + 1);
	}

	return (
		<div ref={previewWorkspaceRef} className="preview-workspace" tabIndex={-1}>
			{showToolbar && (
				<div className="preview-toolbar" aria-label="Preview viewport mode">
					<span className="preview-toolbar-label">Preview</span>
					<div
						className="preview-toggle"
						role="group"
						aria-label="Preview size"
					>
						<button
							type="button"
							className={previewMode === "desktop" ? "active" : ""}
							onClick={() => onPreviewModeChange?.("desktop")}
							aria-pressed={previewMode === "desktop"}
						>
							Desktop
						</button>
						<button
							type="button"
							className={previewMode === "mobile" ? "active" : ""}
							onClick={() => onPreviewModeChange?.("mobile")}
							aria-pressed={previewMode === "mobile"}
						>
							Mobile
						</button>
					</div>
				</div>
			)}

			<div className={`s2c-preview-shell ${previewMode}`} id="s2c-preview">
				<iframe
					ref={iframeRef}
					className="s2c-preview-frame"
					title="Screenshot-to-code responsive preview"
					srcDoc={preparedHtml}
					tabIndex={-1}
					onLoad={handleLoad}
				/>
			</div>
		</div>
	);
}

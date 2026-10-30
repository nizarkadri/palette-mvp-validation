import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	SCREENSHOT_TO_CODE_STRICT_SYSTEM_PROMPT,
	TEXT_ONLY_VISUAL_CORRECTION_PROMPT,
	VISUAL_EVALUATION_SHAPE,
	VISUAL_EVALUATOR_SYSTEM_PROMPT,
	buildVisualCorrectionUserText,
	buildVisualEvaluatorUserText,
} from "../../src/prompts/index.js";
import {
	SCREENSHOT_VIEWPORT,
	VISUAL_VERIFICATION_MIN_SCORE,
} from "../constants.js";
import { rethrowIfProcessorControlFlow } from "../shared/errors.js";
import { executeRenderOperation } from "../shared/renderExecution.js";
import { getScreenshotBrowser } from "./browserPool.js";
import {
	ProviderRequestError,
	callOpenRouter,
	callOpenRouterForProcessor,
	parseOrRepair,
	parseOrRepairForProcessor,
} from "./openRouter.js";
import {
	documentForScreenshot,
	finalizeGeneratedHtml,
	htmlFromRawModelText,
} from "../utils/html.js";
import { writeDebugJson, writeDebugText } from "../utils/debug.js";
import {
	generateCandidate,
	generationIssues,
	modelSupportsToolUse,
	runHtmlToolAgent,
	variantModelIds,
} from "./screenshotGenerator.js";

function processorBoundaryEnabled({
	context,
	provider,
	nextProviderRequestId,
} = {}) {
	const supplied = [context, provider, nextProviderRequestId].some(
		(value) => value !== undefined,
	);
	if (!supplied) return false;
	if (
		!context ||
		typeof context !== "object" ||
		!provider ||
		typeof provider !== "object" ||
		typeof nextProviderRequestId !== "function"
	) {
		throw new TypeError(
			"Context-aware visual verification requires context, provider, and nextProviderRequestId.",
		);
	}
	return true;
}

async function runVisualCorrectionAgent({
	apiKey,
	modelId,
	base64,
	mediaType,
	renderedScreenshot,
	currentHtml,
	evaluation,
	fitDiagnostics,
	context,
	provider,
	nextProviderRequestId,
}) {
	const useProcessorBoundary = processorBoundaryEnabled({
		context,
		provider,
		nextProviderRequestId,
	});
	const messages = [
		{ role: "system", content: SCREENSHOT_TO_CODE_STRICT_SYSTEM_PROMPT },
		{
			role: "user",
			content: [
				{
					type: "image_url",
					image_url: {
						url: `data:${mediaType};base64,${base64}`,
						detail: "high",
					},
				},
				{
					type: "image_url",
					image_url: {
						url: `data:image/png;base64,${renderedScreenshot.base64}`,
						detail: "high",
					},
				},
				{
					type: "text",
					text: buildVisualCorrectionUserText({
						evaluation,
						currentHtml,
						fitDiagnostics,
					}),
				},
			],
		},
	];

	const supportsToolUse = useProcessorBoundary
		? provider.supportsToolUse
		: modelSupportsToolUse(modelId);
	if (!supportsToolUse) {
		messages[1].content.push({
			type: "text",
			text: TEXT_ONLY_VISUAL_CORRECTION_PROMPT,
		});
		const completion = useProcessorBoundary
			? await callOpenRouterForProcessor({
					apiKey,
					context,
					provider,
					nextProviderRequestId,
					kind: "correction",
					stage: "visual-correction",
					messages,
					maxTokens: 16000,
					json: false,
					temperature: 0.1,
				})
			: await callOpenRouter(apiKey, modelId, messages, 16000, {
					json: false,
					temperature: 0.1,
				});
		const html = htmlFromRawModelText(completion.text);
		if (!html) {
			throw new Error(
				"Text-only visual correction returned no parseable HTML.",
			);
		}
		return { html, data: completion.data, toolEvents: [] };
	}

	return runHtmlToolAgent({
		apiKey,
		modelId: useProcessorBoundary ? provider.modelId : modelId,
		messages,
		initialHtml: currentHtml,
		maxTurns: 4,
		temperature: 0.1,
		context,
		provider,
		nextProviderRequestId,
		initialRequestKind: "correction",
		stagePrefix: "visual-correction",
	});
}

async function measureFrameFit(page) {
	return page.evaluate(() => {
		const tolerance = 2;
		const viewport = {
			width: window.innerWidth,
			height: window.innerHeight,
		};
		const root = document.querySelector(".s2c-screen") || document.body;
		const rootRect = root.getBoundingClientRect();
		const documentScrollWidth = Math.max(
			document.documentElement.scrollWidth,
			document.body?.scrollWidth || 0,
		);
		const documentScrollHeight = Math.max(
			document.documentElement.scrollHeight,
			document.body?.scrollHeight || 0,
		);
		const rootVerticalOverflow = Math.max(
			0,
			root.scrollHeight - root.clientHeight,
			Math.ceil(rootRect.bottom - viewport.height),
			documentScrollHeight - viewport.height,
		);
		const rootHorizontalOverflow = Math.max(
			0,
			root.scrollWidth - root.clientWidth,
			Math.ceil(rootRect.right - viewport.width),
			documentScrollWidth - viewport.width,
		);
		const selectorFor = (element) => {
			if (!element || element === document.body) return "body";
			if (element.id) return `#${element.id}`;
			if (element.classList?.length) {
				return `${element.tagName.toLowerCase()}.${Array.from(element.classList)
					.slice(0, 3)
					.join(".")}`;
			}
			return element.tagName.toLowerCase();
		};
		const scrollableElements = Array.from(document.querySelectorAll("body *"))
			.map((element) => {
				const style = window.getComputedStyle(element);
				const verticalOverflow = element.scrollHeight - element.clientHeight;
				const horizontalOverflow = element.scrollWidth - element.clientWidth;
				return {
					selector: selectorFor(element),
					overflowX: style.overflowX,
					overflowY: style.overflowY,
					verticalOverflow: Math.max(0, Math.ceil(verticalOverflow)),
					horizontalOverflow: Math.max(0, Math.ceil(horizontalOverflow)),
				};
			})
			.filter(
				(entry) =>
					(entry.verticalOverflow > tolerance ||
						entry.horizontalOverflow > tolerance) &&
					/(auto|scroll|hidden|clip)/.test(
						`${entry.overflowX} ${entry.overflowY}`,
					),
			)
			.slice(0, 8);
		const bottomOverflowPx = Math.max(0, Math.ceil(rootVerticalOverflow));
		const rightOverflowPx = Math.max(0, Math.ceil(rootHorizontalOverflow));
		return {
			fitsFrame:
				bottomOverflowPx <= tolerance &&
				rightOverflowPx <= tolerance &&
				scrollableElements.length === 0,
			viewport,
			rootSelector: selectorFor(root),
			rootClientWidth: root.clientWidth,
			rootClientHeight: root.clientHeight,
			rootScrollWidth: root.scrollWidth,
			rootScrollHeight: root.scrollHeight,
			documentScrollWidth,
			documentScrollHeight,
			bottomOverflowPx,
			rightOverflowPx,
			scrollableElements,
		};
	});
}

export class DegradableRenderError extends Error {
	constructor({ cause } = {}) {
		super(
			"The rendered preview is unavailable.",
			cause === undefined ? {} : { cause },
		);
		this.name = "DegradableRenderError";
		this.code = "RENDER_UNAVAILABLE";
		this.safeMessage = "The rendered preview is unavailable.";
	}
}

async function classifyBrowserRenderFailure(operation) {
	try {
		return await operation();
	} catch (error) {
		rethrowIfProcessorControlFlow(error);
		if (error instanceof DegradableRenderError) throw error;
		throw new DegradableRenderError({ cause: error });
	}
}

async function renderHtmlScreenshotLegacy(html, session, fileNameBase) {
	let page;
	const fileName = `${fileNameBase}.png`;
	const filePath = path.join(session.dir, fileName);
	try {
		const browser = await getScreenshotBrowser();
		page = await browser.newPage({
			viewport: SCREENSHOT_VIEWPORT,
			deviceScaleFactor: 2,
		});
		await page.setContent(documentForScreenshot(html), {
			waitUntil: "networkidle",
			timeout: 10000,
		});
		const fitDiagnostics = await measureFrameFit(page);
		await writeDebugJson(session, `${fileNameBase}-fit.json`, fitDiagnostics);
		await page.screenshot({ path: filePath, fullPage: false, type: "png" });
		const buffer = await readFile(filePath);
		return {
			path: filePath,
			relativePath: path.relative(process.cwd(), filePath),
			base64: buffer.toString("base64"),
			mediaType: "image/png",
			fitDiagnostics,
		};
	} catch (error) {
		await writeDebugJson(session, `${fileNameBase}-screenshot-error.json`, {
			message: error.message,
			hint: "Install Playwright's Chromium browser with: npx playwright install chromium",
		});
		return null;
	} finally {
		if (page) await page.close().catch(() => {});
	}
}

export async function renderHtmlScreenshotForProcessor({
	html,
	session,
	fileNameBase,
	context,
} = {}) {
	const fileName = `${fileNameBase}.png`;
	const filePath = session ? path.join(session.dir, fileName) : null;
	try {
		return await executeRenderOperation({
			context,
			stage: `${fileNameBase}-render`,
			operation: async ({ awaitExpensive, capWaitTimeoutMs, deferCleanup }) => {
				const browserStage = `${fileNameBase}-browser`;
				const browser = await awaitExpensive(browserStage, () =>
					classifyBrowserRenderFailure(() =>
						getScreenshotBrowser({
							signal: context.signal,
							deadlineAt: context.effectiveDeadlineAt,
							clock: context.clock,
							stage: browserStage,
							timeoutMs: capWaitTimeoutMs(30_000, browserStage),
						}),
					),
				);
				const page = await awaitExpensive(
					`${fileNameBase}-page`,
					() =>
						classifyBrowserRenderFailure(() =>
							browser.newPage({
								viewport: SCREENSHOT_VIEWPORT,
								deviceScaleFactor: 2,
							}),
						),
					{
						onResolved: (resolvedPage) =>
							deferCleanup("Chromium page cleanup failed.", () =>
								resolvedPage.close(),
							),
					},
				);
				const screenshotDocument = documentForScreenshot(html);
				await awaitExpensive(`${fileNameBase}-content`, () =>
					classifyBrowserRenderFailure(() =>
						page.setContent(screenshotDocument, {
							waitUntil: "networkidle",
							timeout: capWaitTimeoutMs(10000, `${fileNameBase}-content`),
						}),
					),
				);
				const fitDiagnostics = await awaitExpensive(`${fileNameBase}-fit`, () =>
					classifyBrowserRenderFailure(() => measureFrameFit(page)),
				);
				if (session) {
					await awaitExpensive(`${fileNameBase}-fit-debug`, () =>
						writeDebugJson(session, `${fileNameBase}-fit.json`, fitDiagnostics),
					);
				}
				const screenshot = await awaitExpensive(
					`${fileNameBase}-screenshot`,
					() =>
						classifyBrowserRenderFailure(() =>
							page.screenshot({
								...(filePath ? { path: filePath } : {}),
								fullPage: false,
								type: "png",
								timeout: capWaitTimeoutMs(10000, `${fileNameBase}-screenshot`),
							}),
						),
				);
				const buffer = filePath
					? await awaitExpensive(`${fileNameBase}-read`, () =>
							readFile(filePath),
						)
					: Buffer.from(screenshot);
				return {
					path: filePath,
					relativePath: filePath
						? path.relative(process.cwd(), filePath)
						: null,
					base64: buffer.toString("base64"),
					mediaType: "image/png",
					fitDiagnostics,
				};
			},
		});
	} catch (error) {
		rethrowIfProcessorControlFlow(error);
		if (!(error instanceof DegradableRenderError)) throw error;
		// Cleanup failure is not an availability fallback: preserve and reject the
		// primary render error with the cleanup error attached by the coordinator.
		if (
			Array.isArray(error.secondaryErrors) &&
			error.secondaryErrors.length > 0
		) {
			throw error;
		}
		await writeDebugJson(session, `${fileNameBase}-screenshot-error.json`, {
			message: error.safeMessage,
			hint: "Install Playwright's Chromium browser with: npx playwright install chromium",
		});
		return null;
	}
}

export async function renderHtmlScreenshot(
	html,
	session,
	fileNameBase,
	options = {},
) {
	if (options && Object.hasOwn(options, "context")) {
		return renderHtmlScreenshotForProcessor({
			html,
			session,
			fileNameBase,
			context: options.context,
		});
	}
	return renderHtmlScreenshotLegacy(html, session, fileNameBase);
}

export async function evaluateVisualCandidate({
	apiKey,
	modelId,
	base64,
	mediaType,
	renderedScreenshot,
	candidate,
	context,
	provider,
	nextProviderRequestId,
}) {
	const useProcessorBoundary = processorBoundaryEnabled({
		context,
		provider,
		nextProviderRequestId,
	});
	const messages = [
		{
			role: "system",
			content: VISUAL_EVALUATOR_SYSTEM_PROMPT,
		},
		{
			role: "user",
			content: [
				{
					type: "image_url",
					image_url: {
						url: `data:${mediaType};base64,${base64}`,
						detail: "high",
					},
				},
				{
					type: "image_url",
					image_url: {
						url: `data:image/png;base64,${renderedScreenshot.base64}`,
						detail: "high",
					},
				},
				{
					type: "text",
					text: buildVisualEvaluatorUserText(candidate),
				},
			],
		},
	];
	const completion = useProcessorBoundary
		? await callOpenRouterForProcessor({
				apiKey,
				context,
				provider,
				nextProviderRequestId,
				kind: "evaluation",
				stage: "visual-evaluation",
				messages,
				maxTokens: 4000,
				json: true,
				temperature: 0,
			})
		: await callOpenRouter(apiKey, modelId, messages, 4000, {
				json: true,
				temperature: 0,
			});
	const parsed = useProcessorBoundary
		? await parseOrRepairForProcessor({
				apiKey,
				context,
				provider,
				nextProviderRequestId,
				text: completion.text,
				shapeInstructions: VISUAL_EVALUATION_SHAPE,
				stage: "visual-evaluation-json-repair",
			})
		: await parseOrRepair(
				apiKey,
				modelId,
				completion.text,
				VISUAL_EVALUATION_SHAPE,
			);
	return parsed.parsed;
}

export async function evaluateRenderedCandidate({
	apiKey,
	base64,
	mediaType,
	session,
	candidate,
	debugPrefix,
	context,
	provider,
	nextProviderRequestId,
	strictProviderErrors = false,
}) {
	const useProcessorBoundary = processorBoundaryEnabled({
		context,
		provider,
		nextProviderRequestId,
	});
	if (!candidate.renderedScreenshot) return candidate;
	try {
		candidate.visualEvaluation = await evaluateVisualCandidate({
			apiKey,
			modelId: candidate.modelId,
			base64,
			mediaType,
			renderedScreenshot: candidate.renderedScreenshot,
			candidate,
			context,
			provider,
			nextProviderRequestId,
		});
		await writeDebugJson(
			session,
			`${debugPrefix}-visual-evaluation.json`,
			candidate.visualEvaluation,
		);
	} catch (error) {
		rethrowIfProcessorControlFlow(error);
		if (
			useProcessorBoundary &&
			(!(error instanceof ProviderRequestError) || strictProviderErrors)
		) {
			throw error;
		}
		await writeDebugJson(
			session,
			`${debugPrefix}-visual-evaluation-error.json`,
			{ message: error.message },
		);
	}
	return candidate;
}

export async function renderAndEvaluateCandidate({
	apiKey,
	base64,
	mediaType,
	session,
	candidate,
	debugPrefix,
	evaluateVisual = true,
	context,
	provider,
	nextProviderRequestId,
}) {
	const useProcessorBoundary = processorBoundaryEnabled({
		context,
		provider,
		nextProviderRequestId,
	});
	candidate.renderedScreenshot = await renderHtmlScreenshot(
		candidate.html,
		session,
		`${debugPrefix}-rendered`,
		useProcessorBoundary ? { context } : undefined,
	);
	if (evaluateVisual) {
		await evaluateRenderedCandidate({
			apiKey,
			base64,
			mediaType,
			session,
			candidate,
			debugPrefix,
			context,
			provider,
			nextProviderRequestId,
		});
	}
	return candidate;
}

function needsFrameFitCorrection(candidate) {
	return candidate.renderedScreenshot?.fitDiagnostics?.fitsFrame === false;
}

export async function correctCandidateWithVisualFeedback({
	apiKey,
	base64,
	mediaType,
	session,
	candidate,
	debugPrefix,
	correctionKind = "visual",
	context,
	provider,
	nextProviderRequestId,
}) {
	processorBoundaryEnabled({ context, provider, nextProviderRequestId });
	const correction = await runVisualCorrectionAgent({
		apiKey,
		modelId: candidate.modelId,
		base64,
		mediaType,
		renderedScreenshot: candidate.renderedScreenshot,
		currentHtml: candidate.html,
		evaluation: candidate.visualEvaluation,
		fitDiagnostics: candidate.renderedScreenshot?.fitDiagnostics,
		context,
		provider,
		nextProviderRequestId,
	});
	const correctedHtml = finalizeGeneratedHtml({ html: correction.html });
	const correctedIssues = generationIssues(correctedHtml);
	await writeDebugJson(session, `${debugPrefix}-response.json`, {
		modelId: candidate.modelId,
		correctionKind,
		response: correction.data,
	});
	await writeDebugJson(
		session,
		`${debugPrefix}-tool-events.json`,
		correction.toolEvents,
	);
	await writeDebugJson(session, `${debugPrefix}-issues.json`, correctedIssues);
	await writeDebugText(session, `${debugPrefix}.html`, correctedHtml);
	return {
		...candidate,
		html: correctedHtml,
		issues: correctedIssues,
		generation: correction,
		visualCorrected: correctionKind === "visual" || candidate.visualCorrected,
		frameFitCorrected:
			correctionKind === "frame-fit" || candidate.frameFitCorrected,
	};
}

export async function correctFrameFitIfNeeded({
	apiKey,
	base64,
	mediaType,
	session,
	candidate,
	debugPrefix,
	context,
	provider,
	nextProviderRequestId,
}) {
	processorBoundaryEnabled({ context, provider, nextProviderRequestId });
	if (!needsFrameFitCorrection(candidate)) return candidate;
	let corrected = await correctCandidateWithVisualFeedback({
		apiKey,
		base64,
		mediaType,
		session,
		candidate,
		debugPrefix: `${debugPrefix}-frame-fit-correction`,
		correctionKind: "frame-fit",
		context,
		provider,
		nextProviderRequestId,
	});
	corrected = await renderAndEvaluateCandidate({
		apiKey,
		base64,
		mediaType,
		session,
		candidate: corrected,
		debugPrefix: `${debugPrefix}-frame-fit-corrected`,
		evaluateVisual: false,
		context,
		provider,
		nextProviderRequestId,
	});
	return corrected;
}

export function scoreVariant(candidate) {
	const visualScore = Number(candidate.visualEvaluation?.score);
	if (Number.isFinite(visualScore)) return visualScore;
	return Math.max(0, 0.75 - candidate.issues.length * 0.12);
}

export function selectBestVariant(candidates) {
	return candidates
		.map((candidate, order) => ({ candidate, order }))
		.sort((a, b) => {
			const scoreDelta = scoreVariant(b.candidate) - scoreVariant(a.candidate);
			if (Math.abs(scoreDelta) > 0.001) return scoreDelta;
			const issueDelta = a.candidate.issues.length - b.candidate.issues.length;
			if (issueDelta !== 0) return issueDelta;
			return a.candidate.variantIndex - b.candidate.variantIndex;
		})[0]?.candidate;
}

function shouldApplyVisualCorrection(candidate) {
	if (!candidate.renderedScreenshot) return false;
	if (needsFrameFitCorrection(candidate)) return true;
	if (!candidate.visualEvaluation) return false;
	const score = Number(candidate.visualEvaluation.score);
	return (
		candidate.visualEvaluation.recommendedRetry === true ||
		candidate.visualEvaluation.pass === false ||
		(Number.isFinite(score) && score < VISUAL_VERIFICATION_MIN_SCORE)
	);
}

export async function generateVerifiedHtml({
	apiKey,
	env,
	modelId,
	base64,
	mediaType,
	session,
}) {
	const modelIds = variantModelIds(env, modelId);
	const candidateResults = await Promise.allSettled(
		modelIds.map((variantModelId, variantIndex) =>
			generateCandidate({
				apiKey,
				modelId: variantModelId,
				base64,
				mediaType,
				session,
				variantIndex,
			}),
		),
	);
	const candidates = candidateResults
		.filter((result) => result.status === "fulfilled")
		.map((result) => result.value);
	const failedVariants = candidateResults
		.map((result, index) => ({ result, index }))
		.filter(({ result }) => result.status === "rejected")
		.map(({ result, index }) => ({
			variant: index + 1,
			modelId: modelIds[index],
			message: result.reason?.message || String(result.reason),
		}));
	if (failedVariants.length > 0) {
		await writeDebugJson(
			session,
			"generation-variant-errors.json",
			failedVariants,
		);
	}

	const candidateIndexes = new Set(
		candidates.map((candidate) => candidate.variantIndex),
	);
	const hasAllThreeVariants =
		candidates.length === 3 &&
		candidateIndexes.size === 3 &&
		[0, 1, 2].every((index) => candidateIndexes.has(index));
	if (failedVariants.length > 0 || !hasAllThreeVariants) {
		throw new Error("Analysis could not complete all three variants.");
	}

	for (const candidate of candidates) {
		await renderAndEvaluateCandidate({
			apiKey,
			base64,
			mediaType,
			session,
			candidate,
			debugPrefix: `variant-${candidate.variantIndex + 1}`,
		});
	}

	let selected = selectBestVariant(candidates);
	if (shouldApplyVisualCorrection(selected)) {
		const correctionKind = needsFrameFitCorrection(selected)
			? "frame-fit"
			: "visual";
		selected = await correctCandidateWithVisualFeedback({
			apiKey,
			base64,
			mediaType,
			session,
			candidate: selected,
			debugPrefix: "visual-correction",
			correctionKind,
		});
		selected = await renderAndEvaluateCandidate({
			apiKey,
			base64,
			mediaType,
			session,
			candidate: selected,
			debugPrefix: "visual-corrected",
			evaluateVisual: false,
		});
	}

	await writeDebugJson(
		session,
		"generation-variants-summary.json",
		candidates.map((candidate) => {
			const summaryCandidate =
				candidate.variantIndex === selected.variantIndex ? selected : candidate;
			return {
				variant: summaryCandidate.variantIndex + 1,
				modelId: summaryCandidate.modelId,
				issues: summaryCandidate.issues,
				score: scoreVariant(summaryCandidate),
				renderedScreenshot:
					summaryCandidate.renderedScreenshot?.relativePath || null,
				frameFit: summaryCandidate.renderedScreenshot?.fitDiagnostics || null,
				visualEvaluation: summaryCandidate.visualEvaluation,
				visualCorrected: Boolean(summaryCandidate.visualCorrected),
				frameFitCorrected: Boolean(summaryCandidate.frameFitCorrected),
				selected: summaryCandidate.variantIndex === selected.variantIndex,
			};
		}),
	);

	return {
		html: selected.html,
		generation: selected.generation,
		issues: selected.issues,
		selectedVariant: selected.variantIndex + 1,
		variantCount: candidates.length,
		visualCorrected: Boolean(selected.visualCorrected),
		frameFitCorrected: Boolean(selected.frameFitCorrected),
		frameFit: selected.renderedScreenshot?.fitDiagnostics || null,
		visualScore: scoreVariant(selected),
		visualVerificationAvailable: candidates.some(
			(candidate) => candidate.renderedScreenshot,
		),
	};
}

function publicRenderedScreenshot(renderedScreenshot) {
	if (!renderedScreenshot) return null;

	return {
		relativePath: renderedScreenshot.relativePath || null,
		base64: renderedScreenshot.base64 || null,
		mediaType: renderedScreenshot.mediaType || "image/png",
	};
}

export function publicVariant(candidate) {
	return {
		id: `variant-${candidate.variantIndex + 1}`,
		index: candidate.variantIndex + 1,
		modelId: candidate.modelId,
		html: candidate.html,
		issues: candidate.issues,
		score: scoreVariant(candidate),
		visualEvaluation: candidate.visualEvaluation || null,
		renderedScreenshot: publicRenderedScreenshot(candidate.renderedScreenshot),
		frameFit: candidate.renderedScreenshot?.fitDiagnostics || null,
		frameFitCorrected: Boolean(candidate.frameFitCorrected),
	};
}

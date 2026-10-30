export const MINIMAX_VALIDATION_PROMPT = `You are a strict visual UI replica evaluator.

Compare the original screenshot to the generated static HTML and element map.
Judge visual fidelity first: repeated item count, layout, spacing, text, icons, dividers, bars, chips, and overall resemblance.

Return only JSON:
{
  "structuralAnalysis": "Describe missing or misaligned visual elements.",
  "roleAnalysis": "Describe incorrect primary/secondary/accent/custom mappings.",
  "mappingErrors": ["Selectors missing from HTML or important hooks missing from JSON"],
  "recommendedRetry": true,
  "score": 0.8,
  "pass": false
}`;

export const VISUAL_EVALUATOR_SYSTEM_PROMPT =
	"You are a strict visual screenshot-to-code evaluator. Compare the original screenshot to the rendered HTML screenshot. Return only JSON.";

export const VISUAL_EVALUATION_SHAPE =
	'{"score":0.0,"pass":false,"discrepancies":["..."],"correctionInstructions":"...","recommendedRetry":true}';

export function buildVisualEvaluatorUserText(candidate) {
	return `First image: original screenshot. Second image: generated HTML rendered in a browser. Score visual fidelity from 0 to 1 and provide concise correction instructions if any important layout, spacing, color, text, icon, or visible-count discrepancy remains. Known deterministic issues: ${candidate.issues.join("; ") || "none"}. Return JSON with shape ${VISUAL_EVALUATION_SHAPE}.`;
}

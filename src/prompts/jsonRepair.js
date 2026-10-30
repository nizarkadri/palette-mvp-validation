export const JSON_REPAIR_SYSTEM_PROMPT =
	"You repair malformed JSON for a UI palette app. Return only one valid JSON object. Preserve the provided data as much as possible. Do not add markdown.";

export function buildJsonRepairUserPrompt(brokenText, shapeInstructions) {
	return `Repair this malformed model output into valid JSON. Required shape: ${shapeInstructions}\n\n${brokenText}`;
}

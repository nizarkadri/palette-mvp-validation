# Approach Comparison: Screenshot-to-Code vs. Palette-MVP

Both projects share the same core problem: **convert a screenshot image into functional code (HTML/CSS)**. But their architectural approaches to solving this differ in crucial ways. This comparison focuses purely on problem-solving decisions, not production-level maturity.

---

## 1. Single Prompt vs. Two-Stage Pipeline

| Aspect | Screenshot-to-Code | Palette-MVP |
|---|---|---|
| Approach | **Agentic tool-calling loop** (up to 100 turns) | **Two-stage pipeline**: screenshot-to-code agent → semantic categorization pass |

**Screenshot-to-code** collapses everything into one agentic session: the model generates code, edits files, extracts assets, screenshots the result, and iterates — all in one loop.

**Palette-MVP learned (the hard way)** that coupling everything into a single prompt "produced poor fidelity". Their explicit pivot: first agent generates HTML, then a *separate* pass categorizes elements semantically. This decoupling is the single most important architectural decision in the project — it isolated the fidelity problem from the semantic problem.

**Why this matters:** Screenshot-to-code gives the agent more *capability* in one shot; palette-mvp gives each stage a cleaner *optimization surface*. The lesson palette-mvp learned is that mixing "make it look right" and "label the parts" in one turn creates competing gradients.

---

## 2. Tool-Calling Granularity vs. Output Constraints

**Screenshot-to-code** provides fine-grained file tools (`create_file`, `edit_file`) plus visual tools (`generate_images`, `extract_assets`, `screenshot_preview`). The agent can iteratively build, verify visually, and correct.

**Palette-MVP** constrains its agent to produce a single `index.html` (up to 6 turns), then separately validates with `generationIssues()` — 8 heuristic failure patterns (icon libraries, emoji icons, device frames, missing bottom nav, white placeholders, etc.). If it fails, a **retry with explicit correction instructions** fires.

**Key difference:** Screenshot-to-code relies on the agent's own visual reasoning (it can *screenshot its output* with `screenshot_preview`). Palette-MVP doesn't trust self-verification — it uses deterministic post-hoc heuristics and hard constraints in prompts (no icon libraries, no device frames, exact SVG icons baked into the system prompt from the ported `screenshotToCodePrompts.js`).

---

## 3. Prompt Engineering: The Real Consistency Secret

This is where screenshot-to-code's consistency advantage lives.

### a) Hard constraints in prompts, not optional guidance

The palette-mvp explicitly ports `SCREENSHOT_TO_CODE_SYSTEM_PROMPT` and `SCREENSHOT_TO_CODE_STRICT_SYSTEM_PROMPT` from the abi/screenshot-to-code project. These aren't loose instructions — they're engineering-mandated constraints: "no icon libraries", "no device frames", "exact SVG icons", "no emoji icons". The consistency doesn't come from a better model; it comes from **ruthless constraint encoding** that eliminates entire failure categories.

### b) Multi-model parallel variants

Screenshot-to-code runs **N model variants in parallel** (typically 2, configurable). This hedges against single-model variance — if one variant produces garbage, another may succeed. The WebSocket streams `variantCount` / `variantModels` / `variantComplete` so the user picks the best.

Palette-MVP uses a single model call — no hedging.

### c) Generation quality gates (both do this differently)

| Screenshot-to-Code | Palette-MVP |
|---|---|
| Agent self-verifies via `screenshot_preview` tool (visual feedback loop) | Post-generation `generationIssues()` heuristic scan → retry with correction text |

Both validate, but screenshot-to-code uses **in-loop perception** (the model sees its own output), while palette-mvp uses **heuristic rules** (the code checks for known bad patterns). The visual loop is more general; heuristics are more reliable for known patterns but miss novel failures.

---

## 4. Iterative Refinement (Update Mode)

Both support iterative editing but differently:

- **Screenshot-to-code**: Full conversation history + `fileState` persistence. The agent can do `edit_file` (exact string replacement + unified diff), `retrieve_option` to read back variants. This is real multi-turn conversation.
- **Palette-MVP**: Once generated, the loop is "user presses Space to cycle palettes" — the iteration is in the *styling domain*, not the generation domain. Editing the generated code is not a designed workflow.

---

## 5. What Screenshot-to-Code Does Right for Consistency

Summarizing the specific mechanisms that produce more consistent outputs:

1. **Agentic loop with visual self-verification** — The model can screenshot its own output and correct it. This is a closed feedback loop, not a one-shot generation.

2. **Hard constraint encoding in system prompts** — Not "try to avoid icon libraries" but "NEVER use icon libraries. Use inline SVG instead." The palette-mvp project recognized this and ported the exact prompt patterns.

3. **Multi-model hedging** — Running variants in parallel and letting the user pick the best one masks single-model inconsistency.

4. **Tool-calling for precise edits** — `edit_file` with exact string replacement is more reliable than regenerating entire files, which tends to drift.

5. **Asset extraction as a separate tool** — `extract_assets` + `save_assets` means the agent can pull real logos/images from the screenshot instead of hallucinating them, then reference them in generated code.

6. **Streaming transparency** — The WebSocket event system (`toolStart`, `toolResult`, `thinking`) means failures are debuggable. You can see *where* the agent went wrong.

---

## 6. What Palette-MVP Does Better (for its specific use case)

- **The two-stage decoupling** is genuinely smart for its domain — palette exploration doesn't need the full agentic loop, it needs clean semantic separation of "what is this element" and "what color should it be".
- **Deterministic quality gates** (`generationIssues()`) catch known failure modes reliably, unlike hoping the agent self-corrects.
- **Heuristic validation + retry** is simpler and more predictable for a bounded problem (single HTML file output).

---

## 7. Preview Interactivity Trade-off

**Problem:** Palette-MVP renders generated HTML in an iframe preview. If generated links/buttons are clickable, `href="#"` or relative URLs can navigate the iframe back into the app, causing the nested/duplicated UI glitch. Clicking inside the iframe can also steal focus from the main UI, making keyboard actions like Space feel unresponsive.

**Chosen solution:** Treat the preview as a visual canvas: preserve the generated HTML as-is, but block iframe click activation (`pointerdown`/`mousedown`/`click`/`auxclick`, plus form submit safety) and return focus to the parent UI. This keeps hover/animations available while preventing links/buttons from doing anything.

**Trade-off:** This disables click interactions inside the preview, but that is acceptable because the preview is for visual palette editing, not browsing or using the generated page.

---

## Bottom Line

The consistency advantage of screenshot-to-code over a naive single-prompt approach comes down to three things:

1. **Closed-loop visual verification** (agent sees its own output)
2. **Hard constraints that eliminate failure categories** rather than hoping the model avoids them
3. **Multi-model hedging** to smooth out per-model variance

Palette-MVP already learned lesson #2 (it ported the prompts). The biggest unlock for palette-mvp's consistency would be adding **lesson #1** — even a simple post-generation screenshot comparison or a second-pass "does this look like the original?" check would catch failures that heuristic rules miss.

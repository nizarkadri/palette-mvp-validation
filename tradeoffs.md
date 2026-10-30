# Development Trade-offs

Living document for important product and engineering trade-offs made during
Palette-MVP development.

---

## 1. Two-stage AI pipeline instead of one all-in-one prompt

**Decision:** Generate screenshot-to-code HTML first, then run a separate semantic
categorization pass for palette-editable elements.

**Why:** Combining visual reconstruction and semantic color-role labeling in one
model response reduced fidelity and made failures harder to debug.

**Trade-off:** More API calls and latency, but cleaner responsibilities and better
debugging.

---

## 2. Multi-model variant generation instead of duplicate primary model

**Decision:** Use distinct default variant models:

1. `minimax/minimax-m3`
2. `google/gemini-3.1-flash-image`
3. `google/gemini-3.1-flash-lite-image`

**Why:** Duplicating MiniMax made failures correlated; if MiniMax failed, two
variants often disappeared.

**Trade-off:** Output style may vary more between variants, but reliability and
coverage improve.

---

## 3. User-driven improvement instead of forcing three variants

**Decision:** Do not force exactly three successful variants. If fewer variants
succeed, let the user improve the closest successful variant with a one-click
refinement pass.

**Why:** Model failures are probabilistic. Retrying just to fill a count can waste
time, while improving a known-good candidate gives the model stronger context.

**Trade-off:** The user may see fewer initial options, but each good option has a
clear recovery path. Improvement adds another model call and can still fail.

---

## 4. Preview iframe as visual canvas, not functional page

**Decision:** Preserve generated HTML visually, but block iframe click activation
and form submission.

**Why:** Generated links like `href="#"` can navigate the iframe into the app
itself, causing nested/duplicated UI glitches. Clicking inside the iframe can
also steal focus from the main UI and make keyboard actions like Space feel
unresponsive.

**Trade-off:** Buttons/links inside the preview are not usable, but that is
acceptable because the preview is for visual palette editing, not browsing the
generated page. Hover styles and CSS animations can remain.

---

## 5. Preserve generated markup instead of rewriting links/buttons

**Decision:** Do not remove or rewrite generated `href`, button, or form markup
just to disable interactions.

**Why:** The preview should remain close to the model output for visual
inspection, palette targeting, and debugging.

**Trade-off:** Requires runtime interaction guarding in the iframe, but keeps
generated HTML faithful and easier to inspect.

---

## 6. Deterministic quality gates plus AI correction

**Decision:** Use code-level checks for known bad generation patterns, then
retry/correct with explicit instructions when needed.

**Why:** Deterministic checks catch recurring issues such as icon libraries,
emoji icons, device frames, and internal scrolling more reliably than hoping the
model self-polices.

**Trade-off:** Heuristics are predictable for known failures but can miss novel
visual problems.

---

## 7. Palette editing stays local after analysis

**Decision:** Palette cycling, role movement, locks, and preview recoloring run
locally after AI analysis.

**Why:** Palette exploration should feel instant and should not require repeated
model calls.

**Trade-off:** The initial AI mapping must be good enough; later palette edits
depend on the quality of generated selectors and semantic roles.

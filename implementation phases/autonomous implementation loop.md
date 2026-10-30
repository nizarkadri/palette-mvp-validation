# Autonomous Implementation Loop

This project can be implemented using a bounded autonomous loop.

## Loop Goal

Work through the micro-commit plan with minimal user interruption while keeping the implementation safe, reviewable, and aligned with the core idea:

> **Upload your UI → AI understands the visual roles → user rapidly vibe-tests palettes on something that looks like their actual product.**

## Loop Unit

Each checkbox in `micro commit tracker.md` is one loop unit.

Example:

```txt
01.01 Add element normalization helper
01.02 Use normalization in AI response parsing
01.03 Update JSDoc/comments for element model
```

## Loop Algorithm

For each micro-commit:

1. Read the relevant phase file.
2. Read affected source files before editing.
3. Implement the smallest safe change for that micro-commit only.
4. Run targeted validation if available.
5. Run build validation after each phase, or sooner if a change is risky:

```bash
npm run build
```

6. If validation fails:
   - inspect the error,
   - fix within the same micro-commit scope,
   - rerun validation.
7. Update `micro commit tracker.md` by checking the completed item.
8. Continue to the next micro-commit.

## Recommended Loop Scopes

The user plans to start a fresh session for every phase using `/new`.

Default loop scope:

```txt
Run one phase only.
```

Phase transition workflow:

```txt
complete current phase → update tracker/progress log → stop → user runs /new → next phase
```

Only run multiple phases in one session if the user explicitly asks.

Only run Phase 09 when backend/model integration is explicitly in scope.

## Stop Conditions

Stop and ask the user if:

- a product decision is not already answered in the plan,
- a destructive or broad architectural change is needed,
- `.env` or `OPENROUTER_API_KEY` is missing when backend/model work starts,
- build errors imply the plan needs revision,
- a dependency choice is required and not documented,
- the source code differs substantially from the assumptions in the plan,
- all requested phases are complete.

## Do Not Stop For

Do not interrupt the user for routine issues that can be fixed locally, such as:

- lint/build errors caused by the current micro-commit,
- import/export mistakes,
- minor CSS adjustments,
- local refactors needed to complete the current micro-commit,
- documentation tracker updates.

## Safety Rules

- Never expose `OPENROUTER_API_KEY` to browser code.
- Never add API calls during palette cycling.
- Never mutate the generated HTML string during palette cycling.
- Always scope DOM queries to the preview root.
- Keep the preview-first product experience intact.
- Reject nonexistent manual classes unless the user later changes this decision.
- Prefer small, reviewable edits over large rewrites.

## Per-Phase Validation Recommendation

- Phase 01: build should pass; old AI response shape should still normalize.
- Phase 02: prompt and parser should accept new fields; class coverage validation should not crash.
- Phase 03: build should pass; palette cycling should remain DOM-style based.
- Phase 04: build should pass; no behavior change when locks are off.
- Phase 05: lock UI should not interfere with palette nav.
- Phase 06: manual add/remove/rename/text lock should update state safely.
- Phase 07: refresh should restore session; Start Over should clear it.
- Phase 08: export should match effective palette.
- Phase 09: frontend should call backend; API key stays server-side.

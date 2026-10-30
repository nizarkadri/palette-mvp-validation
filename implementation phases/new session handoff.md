# New Session Handoff

Use this file at the start of a new implementation session.

The user plans to start a new session for every phase using `/new`.

At the end of each phase:

1. Update `implementation phases/micro commit tracker.md`.
2. Update `implementation phases/progress log.md` with what changed and validation status.
3. Tell the user the phase is complete and that they can run `/new` for the next phase.

## Project Core Idea

The core product loop is:

> **Upload your UI → AI understands the visual roles → user rapidly vibe-tests palettes on something that looks like their actual product.**

Every implementation decision should support that loop.

## Current Status

Planning is complete. Implementation has **not** started yet.

Do not assume source code already includes the planned features. The current app is still the baseline React/Vite MVP described in `src/idea.md`.

## User-Confirmed Decisions

- Start implementation with **Phase 01 — Element Model Foundation**.
- Implement core UX phases first before backend/model integration, unless priorities change.
- Use **MiniMax M3 via OpenRouter** as the initial model for both generation and optional validation.
- Use environment variable:

```bash
OPENROUTER_API_KEY=...
```

- The key already exists in `.env`.
- Reject nonexistent manual class names when users add elements manually.
- Start text contrast logic based on `palette.primary`; improve later if needed.
- Do not start implementation until explicitly asked.

## Main Files to Read First

1. `core idea.md`
2. `implementation plan.md`
3. `implementation phases/phase index.md`
4. `implementation phases/micro commit tracker.md`
5. `implementation phases/phase 00 decision log.md`
6. `implementation phases/autonomous implementation loop.md`
7. `implementation phases/model strategy minimax m3.md`
8. `implementation phases/minimax prompts.md`

## Implementation Entry Point

When the user says to start, begin at:

```txt
Phase 01 — Element Model Foundation
Commit 01.01 — Add element normalization helper
```

Follow `implementation phases/micro commit tracker.md` one item at a time.

## Recommended Session Scope

Because the user wants a new session for every phase, run **one phase per session**.

Recommended order:

```txt
Phase 01 → /new → Phase 02 → /new → Phase 03 → /new → ...
```

Use `implementation phases/start command examples.md` for phase-specific prompts.

## Validation

After meaningful changes, run:

```bash
npm run build
```

If model/backend integration begins, also verify `.env` loading and that the browser does not receive the OpenRouter API key.

## Stop Conditions

Stop and ask the user only if:

- a product decision is not covered by the plan,
- a destructive change is needed,
- `.env`/OpenRouter setup is missing or invalid,
- build fails for a reason requiring scope change,
- the implementation plan appears wrong,
- all requested phases are complete.

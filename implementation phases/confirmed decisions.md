# Confirmed Decisions

This file records user-confirmed implementation decisions.

## Implementation Timing

Implementation has not started yet.

The user will start implementation in a new session.

## Phase Order

Start with:

```txt
Phase 01 — Element Model Foundation
```

Recommended first autonomous scope:

```txt
Phases 01–03
```

Then continue to phases 04–08 for the core UX loop.

## Backend Timing

Implement core UX first.

Do backend/OpenRouter integration later unless the user explicitly asks to prioritize real model calls earlier.

## Model Strategy

Use MiniMax M3 through OpenRouter as the initial model for both generation and optional validation.

```txt
Provider: OpenRouter
Model id: minimax/minimax-m3
```

The user confirmed the OpenRouter key exists in `.env`.

Expected env var:

```bash
OPENROUTER_API_KEY=...
```

## Manual Class Behavior

Reject nonexistent manual class names.

Reason:

- A nonexistent class creates a no-op kanban item.
- The product should preserve trust by only allowing controls that affect the actual recreated UI.

## Text Contrast Behavior

Start with light/dark detection based on `palette.primary`.

Future improvement:

- contrast against actual element/background color.

## Autonomous Loop

The user asked whether a loop can be used to keep working without interference.

Answer: yes.

Use `implementation phases/autonomous implementation loop.md`.

Stop only for blockers, uncovered decisions, destructive changes, invalid assumptions, or completion.

## UX Refresh Decisions — Do Not Implement Until Asked

The user confirmed the following requirements after reviewing `finalExpect.png` and `labelsSample.png`:

1. If an uploaded image contains multiple screens, automatically focus on the first screen only.
2. Treat generated output as responsive website code, not as a forced mobile-app frame.
3. Add a mobile/desktop preview toggle by changing the preview viewport/context.
4. Use a clean minimalist palette panel like `finalExpect.png`.
5. Categorize dynamic screenshot-specific labels into grouped pills, e.g. `Secondary text & labels` or `Category cards`.
6. Hovering a pill should highlight all matching similar elements in the preview, as shown in `labelsSample.png`.
7. Pills must remain draggable/recategorizable between Primary / Secondary / Accent / Custom.
8. Remove Copy CSS; keep only copyable hex color values.
9. Do not allow internal scroll inside the generated preview.

Planning reference: `implementation phases/phase 11 minimalist responsive palette UX.md`.

# Start Command Examples

These are example prompts the user can paste into a new session.

The user plans to start a fresh session for every phase using `/new`.

Recommended workflow:

```txt
/new
[paste the phase-specific prompt]
```

## Phase-by-phase session prompts

### Phase 01

```txt
Read `core idea.md`, `implementation plan.md`, `implementation phases/new session handoff.md`, `implementation phases/confirmed decisions.md`, and `implementation phases/phase 01 element model foundation.md`. Start and complete Phase 01 only. Follow `implementation phases/micro commit tracker.md` one micro-commit at a time, update the tracker, run validation, and stop when Phase 01 is complete or blocked. Do not implement later phases.
```

### Phase 02

```txt
Read `core idea.md`, `implementation plan.md`, `implementation phases/new session handoff.md`, `implementation phases/confirmed decisions.md`, `implementation phases/minimax prompts.md`, and `implementation phases/phase 02 exhaustive ai categorization.md`. Start and complete Phase 02 only. Follow `implementation phases/micro commit tracker.md`, update the tracker, run validation, and stop when Phase 02 is complete or blocked. Do not implement backend/model integration yet.
```

### Phase 03

```txt
Read `core idea.md`, `implementation plan.md`, `implementation phases/new session handoff.md`, `implementation phases/schema contracts.md`, and `implementation phases/phase 03 palette engine intent refactor.md`. Start and complete Phase 03 only. Follow `implementation phases/micro commit tracker.md`, update the tracker, run validation, and stop when Phase 03 is complete or blocked.
```

### Phase 04

```txt
Read `core idea.md`, `implementation plan.md`, `implementation phases/new session handoff.md`, `implementation phases/state model.md`, and `implementation phases/phase 04 role color locks.md`. Start and complete Phase 04 only. Follow `implementation phases/micro commit tracker.md`, update the tracker, run validation, and stop when Phase 04 is complete or blocked.
```

### Phase 05

```txt
Read `core idea.md`, `implementation plan.md`, `implementation phases/new session handoff.md`, and `implementation phases/phase 05 palette strip lock ui.md`. Start and complete Phase 05 only. Follow `implementation phases/micro commit tracker.md`, update the tracker, run validation, and stop when Phase 05 is complete or blocked.
```

### Phase 06

```txt
Read `core idea.md`, `implementation plan.md`, `implementation phases/new session handoff.md`, `implementation phases/no assumption rules.md`, and `implementation phases/phase 06 kanban element controls.md`. Start and complete Phase 06 only. Follow `implementation phases/micro commit tracker.md`, update the tracker, run validation, and stop when Phase 06 is complete or blocked. Reject nonexistent manual classes.
```

### Phase 07

```txt
Read `core idea.md`, `implementation plan.md`, `implementation phases/new session handoff.md`, `implementation phases/schema contracts.md`, and `implementation phases/phase 07 minimal persistence.md`. Start and complete Phase 07 only. Follow `implementation phases/micro commit tracker.md`, update the tracker, run validation, and stop when Phase 07 is complete or blocked.
```

### Phase 08

```txt
Read `core idea.md`, `implementation plan.md`, `implementation phases/new session handoff.md`, and `implementation phases/phase 08 effective export.md`. Start and complete Phase 08 only. Follow `implementation phases/micro commit tracker.md`, update the tracker, run validation, and stop when Phase 08 is complete or blocked.
```

### Phase 09

```txt
Read `core idea.md`, `implementation plan.md`, `implementation phases/new session handoff.md`, `implementation phases/model strategy minimax m3.md`, `implementation phases/minimax prompts.md`, `implementation phases/openrouter integration notes.md`, and `implementation phases/phase 09 backend proxy production safety.md`. Start and complete Phase 09 only. Use OpenRouter MiniMax M3 for model integration, read `OPENROUTER_API_KEY` from `.env`, never expose it to browser code, update the tracker, run validation, and stop when Phase 09 is complete or blocked.
```

## Multi-phase prompts, if wanted later

### Start conservatively

```txt
Read `core idea.md`, `implementation plan.md`, and `implementation phases/new session handoff.md`. Start the autonomous implementation loop for Phase 01 only. Follow `implementation phases/micro commit tracker.md`. Stop only on blockers or completion. Do not implement backend/model integration yet.
```

## Recommended first implementation run

```txt
Read `core idea.md`, `implementation plan.md`, and `implementation phases/new session handoff.md`. Start the autonomous implementation loop for Phases 01–03. Follow `implementation phases/micro commit tracker.md` one micro-commit at a time, update the tracker, and run validation. Stop only on blockers, invalid assumptions, or completion. Do not implement backend/model integration yet.
```

## Core UX run

```txt
Read `core idea.md`, `implementation plan.md`, and `implementation phases/new session handoff.md`. Start the autonomous implementation loop for Phases 01–08. Follow the micro-commit tracker. Keep Space cycling instant, do not add API calls during cycling, and do not implement Phase 09 unless needed. Stop only on blockers, destructive changes, uncovered decisions, or completion.
```

## Full run including backend/model integration

```txt
Read `core idea.md`, `implementation plan.md`, `implementation phases/new session handoff.md`, `implementation phases/model strategy minimax m3.md`, and `implementation phases/minimax prompts.md`. Start the autonomous implementation loop for Phases 01–09. Use OpenRouter MiniMax M3 for model integration, read `OPENROUTER_API_KEY` from `.env`, and never expose it to browser code. Stop only on blockers, missing env setup, destructive changes, uncovered decisions, or completion.
```

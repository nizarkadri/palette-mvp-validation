# No-Assumption Rules

The user explicitly said:

> don't make assumptions and ask questions if in doubt

For the autonomous loop, this means:

## Already Decided — Do Not Ask Again

- Start with Phase 01 when implementation begins.
- Use MiniMax M3 through OpenRouter as the initial model.
- The OpenRouter key exists in `.env`.
- Use `OPENROUTER_API_KEY`.
- Reject nonexistent manual class names.
- Start text contrast based on `palette.primary`.
- Implement core UX before backend unless priority changes.

## Ask Before Proceeding If

- A new dependency is needed and not already recommended/documented.
- A backend runtime must be chosen and the user has not explicitly put Phase 09 in scope.
- A change would alter product behavior beyond the phase plan.
- A destructive operation is needed.
- The current codebase differs significantly from the planned assumptions.
- A model/API behavior is uncertain and cannot be locally validated.

## Safe to Decide Locally

- Small refactor details inside the current micro-commit.
- Naming helper functions.
- Internal file organization when it does not change architecture.
- CSS class names for app shell controls.
- Fixing build errors introduced by the current changes.

## Core Decision Test

If unsure, ask:

> Does this support the loop: upload UI, AI maps visual roles once, user rapidly vibe-tests palettes on a recognizable preview?

If no, defer it.

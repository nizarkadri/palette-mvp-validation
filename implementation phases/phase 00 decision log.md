# Phase 00 — Decision Log

Use this file to record implementation decisions before or during coding.

## Core Decision Filter

Every decision should support this loop:

> **Upload your UI → AI understands the visual roles → user rapidly vibe-tests palettes on something that looks like their actual product.**

## Open Decisions

### Backend priority

Decision needed:

- Implement core UX features first?
- Or implement backend proxy before feature work?

Recommendation:

- Core UX first if still local MVP.
- Backend first if preparing for public deployment.

### Backend target

Options:

- Express
- Cloudflare Worker
- Supabase Edge Function
- Vercel/Next API route
- other

Recommendation for current Vite app:

- Express, unless there is a known deployment target.

### Manual class validation

Decision needed:

- Reject nonexistent manual classes?
- Or allow pending/no-op classes?

Recommendation:

- Reject nonexistent classes to preserve user trust.

### Text contrast strategy

Decision needed:

- Base contrast on `palette.primary` only?
- Or check actual element/background contrast?

Recommendation:

- Start with `palette.primary` for simpler implementation.
- Improve to actual background contrast later.

## User-Confirmed Decisions

- Start with Phase 01 when implementation begins.
- Implement core UX before backend/model integration unless priorities change.
- Use MiniMax M3 via OpenRouter as the initial model for generation and optional validation.
- The OpenRouter key exists in `.env`.
- Use `OPENROUTER_API_KEY` as the environment variable.
- Reject nonexistent manual class names.
- Start text contrast based on `palette.primary`.
- Do not start implementation until the user explicitly asks.

## Decisions Made

### Model strategy

Decision:

- Start with **MiniMax M3 via OpenRouter** as the only AI model for both UI generation and AI validation.
- Use the OpenRouter model id: `minimax/minimax-m3`.
- Keep deterministic local validation in code for schema, class coverage, roles, swatches, and duplicate ids.
- Add stronger or alternative models later only if MiniMax M3 fails frequently.

Rationale:

- MiniMax M3 is multimodal, so it can inspect screenshots directly.
- One-model setup keeps the MVP simpler and easier to debug.
- The app can still protect quality with strict prompts and local validation.

Implication:

- Generation endpoint should call MiniMax M3 through OpenRouter.
- Optional AI validation can also call MiniMax M3 as a second pass, but it should judge/fix only after deterministic validation.

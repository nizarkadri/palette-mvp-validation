# Phase 09 — Backend Proxy / Production Safety

## Goal

Move AI model calls out of the browser before production use.

Core idea connection:

> The backend does not change the palette exploration loop, but it is required before safely shipping the AI analysis step.

## Current Risk

`src/lib/aiAnalysis.js` currently calls Anthropic directly from the browser.

The planned model direction is now:

```txt
OpenRouter model: minimax/minimax-m3
```

OpenRouter API keys must not be exposed client-side, so generation and optional AI validation should move behind a backend endpoint before production use.

## Target API

```txt
POST /api/analyze
```

Request:

```js
{
  base64,
  mediaType
}
```

Response:

```js
{
  html,
  elements,
  validation?: {
    pass,
    score,
    summary,
    missingElements,
    badMappings,
    roleIssues,
    htmlIssues,
    retryInstructions
  }
}
```

## Deployment Options

Choose one before implementation:

- Express server
- Cloudflare Worker
- Supabase Edge Function
- Vercel/Next API route
- other

For the current Vite-only app, the least disruptive local option is Express.

## Micro Commits

### Commit 09.01 — Document MiniMax/OpenRouter model target

Document the model and provider decision.

Acceptance:

- Provider is documented as OpenRouter.
- Model id is documented as `minimax/minimax-m3`.
- Environment variable name is documented, preferably `OPENROUTER_API_KEY`.

### Commit 09.02 — Add backend endpoint

Implement `POST /api/analyze`.

Acceptance:

- Endpoint accepts `{ base64, mediaType }`.
- Endpoint calls OpenRouter server-side using `minimax/minimax-m3`.
- Endpoint returns `{ html, elements }`.

### Commit 09.03 — Move prompt/server OpenRouter call to backend

Shift API-specific request construction to the backend.

Acceptance:

- Browser no longer contacts AI providers directly.
- Browser does not contain an OpenRouter API key.

### Commit 09.04 — Update frontend analyzeScreenshot client

Update frontend to call `/api/analyze`.

Acceptance:

- Upload flow works through backend endpoint.
- Error messages remain user-friendly.

### Commit 09.05 — Document env and run commands

Update README with backend setup.

Acceptance:

- `OPENROUTER_API_KEY` is documented.
- Local dev command is documented.

### Commit 09.06 — Add optional MiniMax validation pass

After deterministic validation, optionally ask MiniMax M3 to judge whether the generated HTML and element map are good enough for palette exploration.

Acceptance:

- Validation returns structured JSON.
- Validation does not rewrite UI by default.
- Failed validation can trigger a retry or show a recoverable error.

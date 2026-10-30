# OpenRouter Integration Notes

These notes are for Phase 09 or whenever model/backend integration begins.

## Provider and Model

```txt
Provider: OpenRouter
Model: minimax/minimax-m3
```

## Environment Variable

The user said the key already exists in `.env`.

Use:

```bash
OPENROUTER_API_KEY=...
```

Do not expose this value to browser/client code.

## Backend Requirement

Browser code should call an app endpoint such as:

```txt
POST /api/analyze
```

The backend should call OpenRouter server-side.

## Request Shape

Frontend to backend:

```js
{
  base64,
  mediaType
}
```

Backend to frontend:

```js
{
  html,
  elements,
  validation // optional later
}
```

## OpenRouter Chat Shape — Conceptual

Implementation details may depend on the OpenRouter API version, but the call will be equivalent to:

```js
fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'minimax/minimax-m3',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: generationPrompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mediaType};base64,${base64}`
            }
          }
        ]
      }
    ]
  })
});
```

## Important Security Rules

- Never put `OPENROUTER_API_KEY` in Vite client env vars.
- Avoid `VITE_OPENROUTER_API_KEY`; that would expose it to the browser.
- Backend should read `.env` directly.
- Frontend should only call the local/backend endpoint.

## Validation

Even if MiniMax returns JSON, still run deterministic validation before rendering:

- parse JSON
- validate top-level shape
- normalize elements
- reject duplicate ids
- validate roles
- validate swatches
- verify class coverage in returned HTML
- sanitize HTML before rendering

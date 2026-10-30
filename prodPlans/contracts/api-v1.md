# API v1 Contract

- **Status:** Accepted baseline
- **Version:** 1
- **Architecture:** [ADR 0001](../adr/0001-production-architecture.md)

## General Rules

- User API prefix: `/api/v1`.
- User routes require `Authorization: Bearer <Identity Platform ID token>`.
- The internal reconciliation route requires a Google-issued service-account OIDC token, not an Identity Platform token.
- Every owned resource checks the authenticated owner; wrong-owner resources return `404`.
- Every response includes `X-Request-Id`.
- Mutation responses include `Cache-Control: no-store`.
- External timestamps use RFC 3339 UTC.
- Control JSON is limited to 64 KiB. Image bytes never pass through Express.
- `express.json()` is scoped to the `/api/v1` and bounded `/internal` routers. Legacy raw-stream routes remain outside those routers.
- API routes are registered before static serving and SPA fallback.
- Unknown `/api/**` and `/internal/**` paths return JSON errors, never `index.html`.

## Error Envelope

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "safe user-facing message",
    "retryable": false,
    "requestId": "req_...",
    "details": {}
  }
}
```

Do not expose stack traces, object paths, prompts, HTML, provider responses, signed URLs, identity tokens, idempotency keys, or secrets.

## Status Policy

| Status | Meaning |
|---:|---|
| 400 | Schema validation failure |
| 401 | Missing or invalid identity |
| 403 | Authenticated account/policy denial |
| 404 | Missing or wrong-owner resource |
| 409 | Idempotency, generation, or state conflict |
| 410 | Logical artifact expiry |
| 413 | Request/upload limit exceeded |
| 415 | Unsupported media type |
| 429 | User/global quota or admission capacity; include `Retry-After` |
| 503 | Kill switch or failure before durable acceptance |
| 500 | Unexpected server failure |

## Public Endpoints

```text
POST /api/v1/uploads
POST /api/v1/uploads/:uploadId/complete
POST /api/v1/jobs
GET  /api/v1/jobs/:jobId
POST /api/v1/jobs/:jobId/cancel
GET  /api/v1/jobs/:jobId/artifacts/:logicalName
POST /api/v1/colorbrain/anchors
GET  /healthz
GET  /readyz
```

## `POST /api/v1/uploads`

Request:

```json
{
  "fileName": "screen.png",
  "contentType": "image/png",
  "sizeBytes": 481223,
  "sha256": "optional-lowercase-64-hex"
}
```

Allowed types: PNG, JPEG, WebP. Maximum declared size: 10 MiB. SVG and animated formats are rejected.

Response `201`:

```json
{
  "uploadId": "upl_...",
  "upload": {
    "method": "POST",
    "url": "https://storage.googleapis.com/<private-bucket>",
    "fields": {},
    "expiresAt": "2026-07-21T12:10:00Z"
  },
  "constraints": {
    "contentTypes": ["image/png", "image/jpeg", "image/webp"],
    "maxBytes": 10485760,
    "maxWidth": 4096,
    "maxHeight": 4096,
    "maxPixels": 16000000
  }
}
```

The signed POST policy fixes a server-owned staging object and content-length range. The client never provides a bucket/object path.

## `POST /api/v1/uploads/:uploadId/complete`

Request:

```json
{ "sha256": "optional-lowercase-64-hex" }
```

The API observes the staging generation, copies it to a create-only validated object with generation preconditions, and validates the pinned copy's magic bytes, decoded type, actual size, dimensions, pixel count, and SHA-256.

Response `200`:

```json
{
  "uploadId": "upl_...",
  "state": "ready",
  "contentType": "image/png",
  "sizeBytes": 481223,
  "width": 1440,
  "height": 900,
  "sha256": "...",
  "expiresAt": "..."
}
```

Repeated completion is safe only when the recorded validated generation matches. Invalid objects are marked invalid and deleted or quarantined.

## `POST /api/v1/jobs`

Require `Idempotency-Key: <UUID>`.

Primary analysis:

```json
{
  "kind": "analysis",
  "input": { "uploadId": "upl_..." },
  "options": { "variantCount": 3 }
}
```

Categorization:

```json
{
  "kind": "categorization",
  "input": { "sourceJobId": "job_...", "variantId": "variant-1" }
}
```

Improvement:

```json
{
  "kind": "improvement",
  "input": { "sourceJobId": "job_...", "variantId": "variant-1" },
  "options": { "modelProfile": "default" }
}
```

Custom swatch:

```json
{
  "kind": "custom-swatch-analysis",
  "input": { "sourceJobId": "job_...", "variantId": "variant-1" },
  "options": {
    "swatch": { "id": "custom-1", "label": "Custom", "color": "#336699" },
    "elementIds": ["choice-row"],
    "palette": {
      "primary": "#112233",
      "secondary": "#445566",
      "accent": "#778899",
      "text": "#000000",
      "textMuted": "#666666"
    }
  }
}
```

Raw HTML, base64, URLs, object paths, bucket names, and arbitrary model IDs are rejected. Source jobs/artifacts must belong to the caller.

First durable acceptance returns `202` and `Location: /api/v1/jobs/:jobId`:

```json
{
  "job": {
    "id": "job_...",
    "kind": "analysis",
    "state": "queued",
    "stateVersion": 1,
    "progress": { "stage": "queued", "percent": 0, "message": "Waiting to start" },
    "createdAt": "...",
    "deadlineAt": "..."
  }
}
```

A repeated idempotency key with the same canonical request hash returns the same job and `Idempotency-Replayed: true`. The same key with another hash returns `409 idempotency_conflict`.

## `GET /api/v1/jobs/:jobId`

Returns the owner-visible bounded job projection. Include `ETag: <stateVersion>` and honor `If-None-Match` with `304`.

Terminal success contains logical artifact names and bounded summaries, never inline image/HTML payloads or storage paths.

## `POST /api/v1/jobs/:jobId/cancel`

Empty body and idempotent behavior:

- queued: terminal `cancelled`, `200`;
- running: `cancel_requested`, `202`;
- cancel requested: current status, `202`;
- already cancelled: `200`;
- succeeded, failed, or timed out: `409 job_terminal`.

## `GET /api/v1/jobs/:jobId/artifacts/:logicalName`

Verify owner, logical expiry, exact manifest membership, generation, checksum, type, and size. Return a short-lived generation-pinned signed read URL or redirect. Reject slashes, `..`, bucket names, and arbitrary object paths.

## `POST /api/v1/colorbrain/anchors`

Preserve the existing normalized semantic response. Require auth and per-user limits. Every external provider must use approved HTTPS, an explicit timeout, response-size limit, schema validation, and safe fallback. Raw provider payloads are not returned or logged.

## Health

`GET /healthz` returns process liveness and version without dependency calls.

`GET /readyz` verifies parsed startup configuration only; it does not call OpenRouter, Chromium, Firestore, or Storage on every request.

## Internal Reconciliation

`POST /internal/reconcile` requires a GCP service-account OIDC token. Verify signature, issuer, exact audience, and allowlisted scheduler service-account email using `google-auth-library`. Bound each reconciliation run and expose no public redrive endpoint.

## Static and SPA Behavior

```text
GET /                       -> dist/index.html
GET /assets/<hash>          -> immutable static asset
GET /client/route           -> dist/index.html
GET /api/unknown            -> JSON 404
POST /api/unknown           -> JSON 404
GET /internal/unknown       -> JSON 404
```

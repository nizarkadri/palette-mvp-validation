# Artifacts v1 Contract

- **Status:** Accepted baseline
- **Manifest schema version:** 1
- **Architecture:** [ADR 0001](../adr/0001-production-architecture.md)

## Objectives

- Keep uploads and generated artifacts private.
- Prevent overwrite/time-of-check-to-time-of-use races.
- Expose only canonical, ownership-checked logical artifacts.
- Make retries and duplicate workers unable to overwrite prior attempts.
- Keep images/HTML/provider payloads out of Firestore and logs.
- Enforce logical expiry independently of asynchronous lifecycle deletion.

## Buckets

Use separate regional buckets in the approved region:

```text
palette-inputs-<environment>
palette-artifacts-<environment>
```

Required controls:

- public access prevention;
- uniform bucket-level access;
- no public ACLs;
- object versioning off;
- narrow runtime service-account IAM;
- lifecycle rules for staging, validated inputs, attempts, and canonical artifacts;
- CORS only for the exact approved browser origins and upload/read methods.

## Object Names

Object names are server generated and never accepted from the browser.

```text
staging/<uidHash>/<uploadId>/source
validated/<uidHash>/<uploadId>/source
jobs/<uidHash>/<jobId>/attempts/<fenceToken>-<attemptId>/<artifact>
jobs/<uidHash>/<jobId>/manifests/<manifestId>.json
```

The public API never returns bucket names or object paths.

## Upload Lifecycle

```text
authorized -> validating -> ready -> claimed
          \-> invalid
          \-> expired
```

### Authorization

The API returns a ten-minute signed POST policy that fixes:

- exact staging object name;
- allowed content type;
- content-length range;
- expiration;
- required policy fields.

Limits:

```text
Formats: PNG, JPEG, WebP
Maximum bytes: 10 MiB
Maximum width: 4096
Maximum height: 4096
Maximum pixels: 16,000,000
Outstanding uploads/user: 3
```

SVG, animated images, unknown formats, and client-selected object names are rejected.

### Finalization

1. Read staging object metadata and exact generation.
2. Copy that generation to the validated path with source-generation match and destination `ifGenerationMatch=0`.
3. Validate the pinned copy, not a mutable staging name.
4. Detect actual format from magic bytes.
5. Compute SHA-256 while reading bounded data.
6. Validate decoded dimensions, pixel count, and decompression limits with bounded `sharp` concurrency/cache.
7. Record generation, metageneration, SHA-256, Storage integrity metadata, content type, size, width, height, and pixel count.
8. Mark ready in a transaction only if the upload is still owned, unexpired, and validating.
9. Mark invalid and delete/quarantine failures.

A repeated finalization request returns the same ready record only when the immutable validated generation matches.

### Claim

A validated upload may seed one primary analysis job. Claiming occurs in the same transaction as job creation. The worker reads the exact validated generation and rechecks SHA-256 before paid work.

## Attempt Artifacts

Every worker attempt writes to its own create-only prefix. Use `ifGenerationMatch=0` and never overwrite another attempt.

Possible analysis artifacts:

```text
variant-1.html
variant-1.png
variant-1-evaluation.json
variant-2.html
variant-2.png
variant-2-evaluation.json
variant-3.html
variant-3.png
variant-3-evaluation.json
selection.json
```

Attempt artifacts are not public merely because they exist. They are accessible only after a canonical manifest references their exact generation and checksum.

## Artifact Limits

```text
Source image:          10 MiB
Generated HTML:       500 KiB
Elements/evaluation: 250 KiB each
Rendered PNG:           5 MiB
Manifest:              64 KiB
```

Overflow is a stable permanent job error. Do not silently truncate semantic results.

## Canonical Manifest

The worker writes an immutable manifest before the final success transaction.

```json
{
  "schemaVersion": 1,
  "jobId": "job_...",
  "jobKind": "analysis",
  "ownerUidHash": "...",
  "processorVersion": "...",
  "promptRevision": "...",
  "modelProfileRevision": "...",
  "attemptId": "...",
  "fenceToken": 3,
  "createdAt": "...",
  "artifactsExpireAt": "...",
  "analysisOutcomes": [
    {
      "index": 0,
      "status": "complete",
      "variantId": "variant-1",
      "artifactKeys": [
        "variant-1.html",
        "variant-1.png",
        "variant-1-evaluation.json"
      ]
    },
    {
      "index": 1,
      "status": "complete",
      "variantId": "variant-2",
      "artifactKeys": [
        "variant-2.html",
        "variant-2.png",
        "variant-2-evaluation.json"
      ]
    },
    {
      "index": 2,
      "status": "complete",
      "variantId": "variant-3",
      "artifactKeys": [
        "variant-3.html",
        "variant-3.png",
        "variant-3-evaluation.json"
      ]
    }
  ],
  "artifacts": {
    "variant-1.html": {
      "objectName": "internal-only",
      "generation": "...",
      "sha256": "...",
      "sizeBytes": 12345,
      "contentType": "text/html; charset=utf-8"
    }
  }
}
```

The object path remains internal. The API public projection exposes only
logical keys such as `variant-1.html`.

For an analysis job, `analysisOutcomes` is mandatory and contains exactly three
entries with unique stable indexes `0`, `1`, and `2`. Every entry must be
`complete`, schema-valid, and reference the exact required logical artifacts for
that processor/schema revision. `selection.json`, when present, must select one
of those indexes. A missing, duplicate, malformed, or failed outcome makes the
manifest ineligible for canonical publication. Partial attempt artifacts remain
private attempt evidence and are never enough for job success.

The final Firestore transaction stores the manifest object/generation/SHA-256
only when:

- job is `running`;
- attempt ID and fence token match;
- cancellation has not won;
- the earlier of `applicationDeadlineAt` and `absoluteJobDeadlineAt` has not
  passed;
- manifest is within bounds and all entries are generation/checksum verified;
- for analysis, all three required stable indexed outcomes satisfy the canonical
  rules above.

Only that pointer makes the result canonical.

## Artifact Read

`GET /api/v1/jobs/:jobId/artifacts/:logicalName`:

1. verifies Identity Platform user and ownership;
2. checks job success and logical artifact expiry;
3. loads the canonical manifest by exact generation;
4. verifies `logicalName` is an exact manifest key;
5. rejects slashes, `..`, bucket names, and arbitrary object names;
6. returns a five-minute, generation-pinned signed read URL or redirect with fixed response content type/disposition and `Cache-Control: private, no-store`.

Signed URLs are not stored in Firestore, localStorage, or logs.

## Retention

Proposed launch defaults:

```text
Staging uploads:      1 day
Validated inputs:    2 days
Attempt artifacts:   7 days
Canonical artifacts: 7 days
Job metadata:       30 days
Idempotency:         1 day
```

The API enforces `artifactsExpireAt` and returns `410 artifact_expired` even if lifecycle deletion has not completed.

Firestore TTL and Storage lifecycle deletion are asynchronous and must not be used as the authorization check.

## Debug and Temporary Data

- Production debug payload capture is disabled.
- Structured metadata may be logged only according to the redaction policy.
- Worker temporary directories are unique per attempt and deleted in `finally`.
- Local filesystem paths never appear in responses.
- Raw OpenRouter responses and prompts are not stored by default.
- Optional support capture is deferred and would require separate consent, access, audit, quota, and retention design.

## Generated HTML Security

Before an HTML artifact is rendered or published:

- sanitize with HTML and CSS allowlists;
- reject scripts, frames, objects, embeds, forms/actions, event handlers, unsafe protocols, remote resource URLs, external SVG references, CSS imports/URLs/fonts/cursors/masks/filters;
- enforce maximum HTML/DOM/CSS complexity;
- render with JavaScript/service workers/downloads/permissions disabled;
- deny document network access;
- inject restrictive CSP;
- validate generated selectors/elements against the HTML contract.

A render security failure is permanent and no HTML artifact becomes canonical.

## User Deletion

Initial deletion is an audited operator procedure:

1. disable new work for the user;
2. cancel or wait for active jobs;
3. delete user input and artifact prefixes;
4. delete user jobs, uploads, idempotency, and quota documents;
5. verify no canonical pointer remains;
6. record only a non-sensitive audit result.

Backup/PITR deletion limitations and response timeline must be included in product privacy documentation before launch.

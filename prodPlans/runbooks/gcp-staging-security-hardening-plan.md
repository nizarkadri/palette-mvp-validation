# GCP Staging Security Hardening Plan

- **Status:** Plan only; no remote changes authorized by this document
- **Parent phase:** Phase 06 — Staging Infrastructure and Delivery
- **Environment:** staging
- **Project:** `palette-503123`
- **Region:** `us-central1`
- **Applies before:** H1–H6-A apply before images, workloads, secret values, or
  user data; H6-B permits only the bounded validation workloads defined below
  and must pass before cohort traffic or user data

## Goal

Replace inherited broad access with explicit least-privilege controls, protect
both Terraform state prefixes, and define a vulnerability-scanning policy
without bypassing owner approval or the current zero-budget constraint.

Each implementation step requires its own preflight, plan or command review,
operations-log entry, validation, cleanup, and micro commit. A failure or
unexpected plan action stops the sequence.

## Verified Baseline

### Terraform

- Staging state is remote, serial `10`, with 33 instances and zero taints.
- A fresh staging plan reports no drift.
- Bootstrap state remains local at
  `infra/terraform/bootstrap/terraform.tfstate`.
- The bootstrap state is ignored and not tracked by Git.
- Bootstrap state serial is `3`, with two managed instances.
- No `bootstrap/default.tfstate` object exists remotely.

### Project IAM

- The operator account is the sole project Owner.
- The default Compute service account is the sole project Editor.
- No project Viewer binding exists.
- The default Compute service account has:
  - no observed principal activity in the available 90-day log window;
  - no Compute VM attachment;
  - no Cloud Run service attachment.

Absence of observed activity is supporting evidence, not proof that no external
or future workflow depends on the account.

### Bucket IAM

The state, input, and artifact buckets contain Storage convenience values for:

- `projectOwner:palette-503123`;
- `projectEditor:palette-503123`;
- `projectViewer:palette-503123`.

Google recommends avoiding convenience values in production because they bridge
broad project basic roles into bucket access.

The application buckets also contain the intended explicit runtime grants:

- input: API object administrator, worker object viewer;
- artifacts: worker object administrator, API object viewer.

### Artifact scanning

- `containeranalysis.googleapis.com` is disabled.
- `containerscanning.googleapis.com` is disabled.
- `ondemandscanning.googleapis.com` is disabled.
- `palette-containers` is empty.
- The current Terraform budget setting is `$0`.

Automatic scanning costs USD `$0.26` for the initial scan of each unique image
digest. Enabling the Container Scanning API starts billing eligibility and also
enables Container Analysis. Re-scans of the same digest are free under the
published standard pricing model.

## Hardening Sequence

## H1 — Migrate Bootstrap State to GCS

### Change

1. Add a committed GCS backend for `infra/terraform/bootstrap`:
   - bucket: `palette-staging-tfstate-palette503123`;
   - prefix: `bootstrap`.
2. Commit the backend configuration before migration.
3. Before requesting migration approval:
   - verify local state serial, lineage, and two instances;
   - create a mode `0600` temporary backup and record its SHA-256;
   - verify the state bucket remains private, uniform-access, and versioned;
   - verify `bootstrap/default.tfstate` is absent;
   - record the bucket metageneration.
4. After separate owner approval, immediately repeat the remote-object absence
   and bucket-metageneration checks. Stop if either changed.
5. Only while the target remains absent, run a locked
   `terraform init -migrate-state -force-copy`.
6. Verify `bootstrap/default.tfstate`, lineage, resources, state locking, and a
   no-drift bootstrap plan.
7. Delete the local state and all temporary evidence only after documentation
   is committed.

### Expected remote impact

- One additional versioned state object under prefix `bootstrap`.
- No GCP resource creation, update, or destruction.

### Rollback

Retain the owner-readable mode `0600` backup until remote state has been pulled
and validated. The backup is not claimed to be encrypted.

If migration fails or a remote object appears unexpectedly, stop all bootstrap
and staging Terraform commands. Preserve both copies, compare lineage and
serial, and obtain a separately reviewed split-brain recovery plan. Do not run
`-force-copy` again or use `terraform state push` as an automatic rollback.

## H2 — Establish Explicit State-Bucket Access

### Proposed policy

Replace the state bucket's entire IAM policy with explicit principals:

- operator `nizar.main01@gmail.com`: `roles/storage.admin`;
- `palette-terraform`: `roles/storage.objectAdmin`.

The operator binding prevents lockout and supports emergency IAM management.
The Terraform identity receives only the object permissions recommended for a
GCS backend. No service-account key is created.

### Terraform design

- Define policy data with `google_iam_policy`.
- Manage the complete policy with `google_storage_bucket_iam_policy` in the
  bootstrap root.
- Grant the operator `roles/iam.serviceAccountTokenCreator` on
  `palette-terraform` using a service-account IAM member resource.
- Do not mix authoritative policy resources with additive IAM member resources
  for the same bucket.
- Apply while authenticated as the exact operator principal.

### State-bucket policy backup and rollback

Immediately before apply:

- request IAM policy version `3` from the Storage JSON API and export the
  returned policy unchanged, including its actual `version` and etag, to a mode
  `0600` file;
- record its SHA-256 and all bindings;
- verify the operator principal can read bucket IAM and state objects;
- prepare but do not execute a restoration procedure.

A policy without conditional bindings correctly returns actual version `1` even
when version `3` is requested. Preserve that returned version; do not rewrite
it to `3`. Requesting version `3` ensures conditions are retained if they are
introduced later.

Emergency restoration must first request version `3` and fetch the current
policy and etag, confirm no concurrent change, then combine the backed-up
bindings with the current etag while preserving the policy's actual version.
Applying that reviewed restoration policy requires separate approval.

### State-bucket validation gate

Before apply, require a reviewed policy diff that removes only convenience
values and adds only the two explicit principals. After apply:

- pull both `bootstrap` and `staging` states;
- verify the operator can acquire a state lock;
- impersonate `palette-terraform` and positively test state-object list, read,
  create, delete, and isolated lock operations;
- verify `palette-terraform` has no user-managed keys;
- verify the default Compute service account cannot read state objects;
- verify public access prevention and versioning remain unchanged.

## H3 — Harden Application-Bucket IAM

### Target policies

Input bucket:

- operator `nizar.main01@gmail.com`: `roles/storage.admin`;
- API runtime: `roles/storage.objectAdmin`;
- worker runtime: `roles/storage.objectViewer`.

Artifact bucket:

- operator `nizar.main01@gmail.com`: `roles/storage.admin`;
- worker runtime: `roles/storage.objectAdmin`;
- API runtime: `roles/storage.objectViewer`.

No convenience values, public principals, browser principals, or unrelated
service accounts remain.

### Safe Terraform transition

The current four additive `google_storage_bucket_iam_member` resources cannot
be mixed with authoritative bucket policy resources.

- **Step 1:** In one commit, remove all four
  `google_storage_bucket_iam_member` declarations from configuration and add
  the two complete authoritative policy resources. No additive bucket IAM
  declaration may remain.
- **Step 2:** Back up and verify staging state.
- **Step 3:** Export both version-3 bucket IAM policies with etags to mode
  `0600` files, record hashes, and prepare the same current-etag restoration
  procedure used for the state bucket.
- **Step 4:** With separate approval, use one locked `terraform state rm`
  command for exactly these addresses:

```text
google_storage_bucket_iam_member.api_input_object_admin
google_storage_bucket_iam_member.api_artifacts_object_viewer
google_storage_bucket_iam_member.worker_input_object_viewer
google_storage_bucket_iam_member.worker_artifacts_object_admin
```

- **Step 5:** Record the state serial transition and verify remote IAM did not
  change.
- **Step 6:** Generate a plan requiring exactly two authoritative policy
  creates, zero recreation of the four obsolete IAM-member addresses, and no
  bucket replacement, lifecycle, location, or data-plane change.
- **Step 7:** Obtain separate apply approval.

### Application-bucket validation gate

- Exact operator principal retains emergency administration.
- API and worker positive access checks pass.
- Cross-role negative checks fail.
- Default Compute service account access fails.
- Anonymous and authenticated-user access fail.
- Bucket location, lifecycle, versioning, CORS, soft delete, and public access
  prevention do not change.
- Policy backups remain available until all checks pass; restoration uses a
  freshly fetched etag and requires separate approval.

## H4 — Remove Default Compute Basic-Role Access

### Proposed action

The Editor grant is an unmanaged project bootstrap binding. Avoid using an
authoritative Terraform `roles/editor` binding because it could remove a future
Editor added outside this repository.

Perform a broader inventory for VM, Cloud Run, Cloud Functions, App Engine,
Cloud Build triggers and build history, worker pools, GKE, Scheduler, Pub/Sub,
and other scheduled or event-driven service-account consumers. Record the
longest known execution cadence and recheck audit logs immediately before
mutation.

Google disables a service account immediately. Existing tokens are rejected,
and new token requests fail. Use two separate owner-approved canary stages:

1. Disable the default Compute service account while leaving Editor attached.
2. Confirm immediate denial using a controlled authentication test.
3. Observe errors, audit logs, and scheduled/event-driven consumers for at
   least 24 hours and long enough to cover the longest known execution cadence.
4. Rerun the full attachment and consumer inventory.
5. If the canary is clean, request separate approval to remove only the exact
   default-account `roles/editor` membership.

All Palette workloads must specify dedicated runtime identities.

### Default-account validation gate

- The default account is disabled and immediate denial is verified.
- The documented observation period covers the longest known consumer cadence
  and is never shorter than 24 hours.
- Project Editor membership is empty only after the second approval.
- Terraform remains drift-free.
- State and application-bucket denial checks pass.
- The full service and event-consumer inventory reports no attachment.

### Default-account rollback

During the disable canary, re-enable the account immediately if an approved
consumer fails; Editor remains available during this stage.

After Editor removal, rollback order is:

1. re-add the exact Editor membership while the account remains disabled;
2. verify the binding;
3. re-enable the account only after separate approval.

Document disabling and Editor removal as separate micro commits.

## H5 — Decide and Configure Image Scanning

### Cost gate

Do not enable paid scanning while the approved infrastructure budget remains
zero. Before the first image push under an automatic or on-demand scanning path,
the owner must approve:

- a non-zero scanning allowance or explicit per-build spend;
- the expected maximum unique image digests per month;
- whether automatic scanning or on-demand pipeline scanning is authoritative;
- the vulnerability severity that blocks deployment.

The documented scanning-disabled risk-acceptance path below is the alternative
when the owner accepts deployment without a GCP vulnerability scan. It does not
approve scanning spend or API enablement.

Automatic scanning cost estimate:

`unique image digests × USD $0.26`

A Google Cloud budget is an alert, not a hard spending cap. Record a numeric
monthly digest or scan ceiling and its estimated maximum cost.

### Automatic-scanning path

After automatic-scan cost approval:

- **Step 1:** Add `containerscanning.googleapis.com` to Terraform required
  services.
- **Step 2:** Confirm Container Analysis becomes enabled automatically.
- **Step 3:** Encode repository behavior in Terraform:

```hcl
vulnerability_scanning_config {
  enablement_config = "INHERITED"
}
```

- **Step 4:** Verify the repository inherits the enabled project scanning
  policy.
- **Step 5:** Build each immutable digest once.
- **Step 6:** Enforce the fail-closed scan-result contract below.
- **Step 7:** Record scan evidence with the digest and SBOM/provenance.

Charge containment and rollback:

- stop image pushes when the digest ceiling is reached;
- disable scanning on `palette-containers` first;
- disable the Container Scanning API only after confirming no other repository
  depends on it;
- record incurred charges, which cannot be rolled back.

### On-demand-scanning path

If the owner selects on-demand scanning:

1. verify current pricing at approval time; current published pricing is USD
   `$0.26` per invocation;
2. record a numeric scan-per-build and monthly scan ceiling;
3. enable only `ondemandscanning.googleapis.com` and required metadata APIs;
4. add the scan to the delivery pipeline;
5. enforce the fail-closed scan-result contract below;
6. keep automatic Container Scanning disabled.

Rollback disables the pipeline scan first and then the API after dependency
review. Do not pay for both paths without an explicit reason.

### Fail-closed scan-result contract

For either paid path, deployment promotion must:

- query findings for the exact immutable image digest, never a mutable tag;
- wait for a terminal successful scan status;
- use a documented bounded timeout, initially 15 minutes and adjustable only
  after staging evidence;
- reject timeout, missing, incomplete, stale, or errored scan results;
- reject findings at or above the owner-approved severity threshold;
- record digest, scanner mode, terminal status, timestamps, findings summary,
  SBOM, provenance, and promotion decision.

An exception must identify one exact digest, named approver, reason, accepted
findings, and expiry no later than 24 hours. Exceptions never carry to another
digest and must be visible in the operations log. API errors fail closed.

Exception expiry is an enforced deployment event, not documentation only.
Store the digest, `expires_at`, last clean rollback digest, approval, and reason
in machine-readable deployment state.

Enforcement runs:

- synchronously on every promotion and deployment action;
- through a scheduled reconciler at least every five minutes;
- immediately when an exception is created, renewed, or revoked.

Do not issue an exception until the reconciler and expiry path pass a staging
test. Enforcement delay after `expires_at` must not exceed five minutes.

Before expiry, supply a clean replacement digest or obtain an explicit renewal
with a new approver, evidence review, reason, and maximum 24-hour expiry. At
expiry without renewal, the reconciler must:

1. block every further promotion of the affected digest;
2. alert the named operator;
3. when deployed, roll back to the recorded last clean digest and verify health;
4. undeploy or scale to zero when no clean rollback digest exists;
5. if automated rollback or undeploy fails or is unsafe, open a security
   incident and require a named operator to record containment, owner, deadline,
   and user impact.

Continued operation after failed remediation requires a newly approved,
digest-specific emergency exception with its own expiry. Never allow silent
continued operation after expiry.

### Scanning-disabled risk-acceptance path

The owner may explicitly accept deployment without automatic or on-demand GCP
container vulnerability scanning. Under that decision:

- keep `containerscanning.googleapis.com`,
  `ondemandscanning.googleapis.com`, and `containeranalysis.googleapis.com`
  disabled;
- do not claim a successful vulnerability scan or vulnerability-free image;
- pin approved upstream base images and final deployment images by immutable
  digest and build with frozen dependency lockfiles;
- retain SBOM and provenance for every promoted digest;
- require non-root containers, secret-free source/build arguments/layers,
  sandboxed Chromium, least-privilege runtime IAM, and digest-only deployment;
- review upstream Chromium/base-image security notices before promotion and
  rebuild promptly when the selected upstream publishes a security update;
- retain the previous known-operational digest and verify rollback before
  production promotion;
- record the owner acceptance and residual risk in the operations log.

This is a documented risk acceptance, not a passed scanning control. It permits
image publishing and deployment promotion when all substitute controls and the
remaining deployment gates pass. It may be revoked at any time; revocation
blocks further promotion until scanning is approved or the risk is accepted
again.

## H6 — Define and Validate Cloud Tasks Queue IAM

H6 is split into two gates:

- **H6-A — post-apply recovery and policy reconciliation:** preserve and
  reconcile the queue IAM bindings that are already applied, commit their
  Terraform definition, and record the procedural sequencing deviation without
  claiming deployed-principal validation.
- **H6-B — deployed-principal validation:** after the Phase 03–05 prerequisites
  and the minimum Phase 06 keyless execution paths exist, validate the access
  matrix from the real workload, build, deployment, and OIDC paths.

H6-A does not complete H6. H6 and H7 remain open until H6-B passes.

### Queue access matrix

- API runtime: `roles/cloudtasks.enqueuer` on `palette-jobs` only.
- Operator `nizar.main01@gmail.com`: `roles/cloudtasks.admin` on the queue for
  incident inspection, run/delete, pause, purge, resume, and IAM recovery.
- `palette-terraform`: `roles/cloudtasks.queueAdmin` on the queue for managed
  queue configuration and IAM.
- Worker, task-invoker, scheduler-invoker, build, and deploy identities: no
  Cloud Tasks queue role.
- Browser and public principals: no queue role.

The task-invoker identity is reserved for later OIDC invocation of the private
worker. It does not enqueue or administer tasks.

### H6-A — Post-apply recovery and policy reconciliation

The three intended queue IAM bindings have already been applied. Preserve the
current remote state and the uncommitted Terraform definitions. Do not reapply,
remove, replace, import, or roll back the bindings during H6-A.

Before committing configuration, perform a fresh read-only reconciliation:

- verify the active operator, project, repository scope, and exact H6 source
  diff;
- pull staging state and verify the expected lineage, serial `13`, 36
  instances, zero taints, no live lock, and a lock-disabled no-drift plan;
- fetch the complete live `palette-jobs` queue IAM policy and require exactly
  the API enqueuer, operator admin, and Terraform queue-admin bindings from the
  access matrix;
- inspect the project hierarchy and all applicable project, folder, and
  organization IAM policies for inherited Cloud Tasks access;
- use direct IAM-policy reads as primary evidence and Cloud Asset results only
  as corroborating evidence because Cloud Asset indexing can lag;
- inspect the current predefined-role permission definitions rather than
  relying only on remembered role contents;
- verify the queue is `RUNNING` and empty and that its rate, retry, logging,
  location, and deadline-related settings did not change;
- reconcile Admin Activity audit events for the completed IAM apply and record
  any unexpected event;
- verify all service accounts remain keyless and that no test-only Token
  Creator, Workload Identity Federation, or other credential grant was added.

`policytroubleshooter.googleapis.com` is disabled at this recovery point. Do
not enable it in H6-A. If separately approved later, Policy Troubleshooter may
support evaluation of inherited allow, deny, conditional, and
principal-boundary policies, but it never replaces H6-B runtime evidence.

Available identity-authenticated H6-A checks are deliberately non-mutating:

- impersonate `palette-terraform` through its existing approved keyless path
  and perform queue/configuration reads;
- call queue `testIamPermissions` as `palette-terraform` and require the
  expected queue read, IAM, update, pause, and purge permissions while task
  creation and task listing are absent;
- perform a read-only task-list check as `palette-terraform` and require
  denial;
- do not attempt task creation, queue pause, queue purge, or another denied
  mutation merely to prove denial.

The operator may perform read-only inspection, but operator success cannot be
attributed solely to the queue-level `roles/cloudtasks.admin` binding while the
same operator remains project Owner. The exact live queue policy, applicable
ancestor policies, Terraform state, and role definitions are the attribution
evidence.

After reconciliation:

1. commit only `infra/terraform/staging/main.tf` and
   `infra/terraform/staging/variables.tf` as
   `infra: define cloud tasks queue iam`;
2. in a separate documentation recovery commit, record the already-completed
   apply, exact state/policy/queue/audit evidence, procedural sequencing
   deviation, retained limitations, and deferred H6-B gate;
3. retain the exact status:
   `IAM configuration applied; deployed-principal validation pending`.

The recovery documentation must not use the final
`docs: record cloud tasks queue iam validation` commit name or claim full H6
validation.

### H6-B prerequisites and validation-workload exception

H6-B begins only after:

- Phases 03–05 are implementation-ready in their declared dependency order;
- H5 permits image publishing through either an approved successful scan or the
  documented scanning-disabled risk acceptance, and every validation image is
  immutable and addressed by exact digest;
- the minimum Phase 06 Cloud Run, Cloud Build, approved keyless deployment,
  Cloud Tasks OIDC, and Cloud Scheduler OIDC paths required by the matrix
  exist.

The pre-workload hardening rule has one narrow exception for H6-B:

- only bounded validation-only revisions or jobs may run;
- use immutable exact-digest images satisfying the active H5 scan or
  scanning-disabled risk-acceptance path, plus synthetic non-sensitive test
  data;
- accept no cohort traffic and process no user data;
- grant no key, test-only Token Creator role, or test-only federation path;
- define the exact creation, execution, evidence-retention, cleanup, and
  rollback boundaries before deployment;
- stop and clean up through the approved boundary on any unexpected access,
  mutation, identity, audience, target, or configuration result.

If H5 has neither a successful scan policy nor an active documented
scanning-disabled risk acceptance, H6-B remains blocked. Risk acceptance removes
only the scanning prerequisite; every other H6-B prerequisite and the separate
validation-workload approval remain mandatory.

### H6-B deployed-principal validation

Use the real keyless execution path for each executable principal. Keep the
future-scheduled queue-IAM task separate from the task that proves OIDC
dispatch:

- API runtime can create a queue-IAM test task only in `palette-jobs`, scheduled
  in the future so it cannot dispatch during the IAM check.
- Operator can inspect and delete the future-scheduled queue-IAM task and can
  pause/resume the empty queue during a separately authorized controlled
  positive check. This exercises operations but does not, while the operator
  remains project Owner, attribute success solely to the queue binding.
- `palette-terraform` can read queue IAM/configuration, and its authenticated
  `testIamPermissions` result excludes task creation and task listing.
- API checks run from the actual Cloud Run identity. Its authenticated
  `testIamPermissions` result includes task creation and excludes task listing,
  queue pause, and queue purge.
- Worker, build, and deploy checks run from their actual Cloud Run, Cloud
  Build, or approved keyless deployment identities. A read-only task-list call
  must fail and authenticated `testIamPermissions` must exclude task creation,
  task listing, queue pause, and queue purge.
- Do not directly invoke a denied mutating method. An accidental permission
  grant would turn a negative test into a queue mutation; use
  identity-authenticated `testIamPermissions` for denied task creation, pause,
  and purge permissions.
- For task-invoker, prove an actual Cloud Tasks OIDC invocation of only the
  private worker, including exact issuer, subject/email, audience, and target
  restriction. Use a separate bounded synthetic OIDC-validation task that
  performs no provider or paid work and contains no user data. Combine that
  deployed OIDC evidence with effective-policy evidence that task-invoker has
  no Cloud Tasks queue permission.
- For scheduler-invoker, prove an actual Cloud Scheduler OIDC invocation
  accepted only by the reconciliation route, including exact issuer,
  subject/email, audience, and target restriction. Combine that deployed OIDC
  evidence with effective-policy evidence that it has no Cloud Tasks queue
  permission.
- Do not construct artificial Scheduler or Tasks jobs whose only purpose is to
  obtain OAuth credentials and call the Cloud Tasks API. The OIDC invocation
  plus effective-policy evidence is the approved substitute for arbitrary
  queue API calls by identities whose approved use in Palette is OIDC-only.
- Delete the future-scheduled queue-IAM task before dispatch. Verify the
  separate OIDC-validation task reaches its expected terminal result and the
  queue returns to empty.
- Queue rate, retry, logging, location, and empty-state settings do not change.
- Repeat the complete live queue-policy and applicable ancestor-policy checks
  after runtime validation; Terraform no-drift alone is insufficient because
  additive IAM-member resources do not detect unrelated extra bindings.

Do not claim final queue IAM validation until H6-A reconciliation and every
H6-B binding, runtime, OIDC, effective-policy, cleanup, and configuration check
passes.

## H7 — Final Security Validation

The hardening checkpoint passes only when:

- bootstrap and staging state are remote, versioned, lockable, and drift-free;
- no local Terraform state or saved plan remains;
- all three buckets have only documented explicit principals;
- default Compute Editor access is removed and the account is disabled;
- all service accounts remain keyless;
- state, bucket, secret, H6-A reconciliation, and H6-B queue
  positive/negative IAM and OIDC tests pass;
- every deployed image either has a successful approved scan for its exact
  digest or is covered by the documented scanning-disabled owner risk
  acceptance and all substitute controls above;
- the operations log records every remote action and rollback boundary.

## Micro-Commit Sequence

1. `infra: configure bootstrap remote backend`
2. `docs: record bootstrap state migration`
3. `infra: define explicit state bucket iam`
4. `docs: record state bucket hardening`
5. `infra: define application bucket policies`
6. `docs: record application bucket hardening`
7. `docs: record default compute disable canary`
8. `docs: record default compute editor removal`
9. `docs: split cloud tasks queue iam validation gates`
10. `infra: define cloud tasks queue iam`
11. `docs: record cloud tasks queue iam recovery`
12. `infra: configure approved image scanning` when spend is approved
13. `docs: record scanning deferred` when spend is not approved
14. `docs: accept scanning-disabled deployment risk` only after explicit owner
    acceptance and substitute-control review
15. `docs: record cloud tasks queue iam validation` only after H6-B
16. `docs: close staging security checkpoint`

Commit names may be adjusted to match the exact implemented scope, but each
commit must remain independently reviewable.

## Permission Gates

Owner approval is required before:

- migrating bootstrap state;
- changing any remote state metadata;
- replacing a bucket IAM policy;
- removing or disabling a service account or role;
- enabling a billable scanning API;
- enabling Policy Troubleshooter for supporting evidence;
- deploying or executing an H6-B validation workload;
- running an expected-positive queue mutation such as task creation,
  deletion, pause, purge, or resume;
- applying any plan with update or destroy actions.

## External References

- [Artifact Analysis automatic scanning](https://cloud.google.com/artifact-analysis/docs/enable-automatic-scanning)
- [Artifact Analysis pricing](https://cloud.google.com/artifact-analysis/pricing)
- [Cloud Storage IAM](https://cloud.google.com/storage/docs/access-control/iam)
- [Terraform GCS backend](https://developer.hashicorp.com/terraform/language/backend/gcs)
- [Terraform Storage bucket IAM](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/storage_bucket_iam)
- [Disable a service account](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/disable)
- [Cloud Tasks IAM](https://cloud.google.com/tasks/docs/access-control)
- [Terraform Artifact Registry repository](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/artifact_registry_repository)

# GCP Staging Operations Log

This log records every remote Google Cloud action taken for the Palette staging environment so infrastructure work remains auditable, phase-based, and reversible.

## Operating rules

- Work phase by phase from `prodPlans/phases/`.
- Use micro commits scoped to the current phase/step.
- Do not apply destructive Terraform plans without explicit owner approval.
- Do not commit secret values, local Terraform state, Terraform plans, billing account IDs, or credential files.
- If an apply/validation result diverges from the plan, stop, document the issue here, reassess the affected plan/code, and ask for owner approval before proceeding with a revised plan.

## Environment baseline

| Field | Value |
|---|---|
| Phase | Phase 06 — Staging Infrastructure and Delivery |
| Environment | staging |
| GCP project ID | `palette-503123` |
| Region | `us-central1` |
| Storage location | `US-CENTRAL1` |
| Terraform auth | Local Google ADC for owner account |
| Future Terraform alert email | `nizar.main01@gmail.com` |
| Terraform budget setting | `$0`; no budget resource is created |
| Production project | Not created; separate production project deferred |

At reconciliation time, the billing account also contains an existing
account-wide `Portfolio` budget for CAD `$0`. It is not project-filtered or
managed by this Terraform root.

## 2026-07-22 — Bootstrap Terraform state bucket

### Bootstrap intent

Create only the remote Terraform state bucket for the staging project. This is
the prerequisite for managing later staging resources with a GCS backend.

### Terraform root

`infra/terraform/bootstrap`

### Planned remote changes

- Enable or confirm `storage.googleapis.com` for state bucket management, with
  `disable_on_destroy = false`.
- Create private GCS bucket `palette-staging-tfstate-palette503123` with:
  - uniform bucket-level access;
  - public access prevention;
  - versioning enabled;
  - `force_destroy = false`;
  - archive cleanup after 30 days and 10 newer versions.

### Servers / CPU / runtime impact

None. This step creates no Cloud Run services, VMs, containers, CPUs, jobs,
schedulers, or public endpoints.

### Bootstrap budget / alert impact

No budget or alerting resource is created in this bootstrap step. The staging
alert email is documented for later budget/monitoring resources after a
non-zero threshold is approved.

### Validation before apply

- `terraform fmt`
- `terraform validate`
- `terraform plan`
- Plan result: `2 to add, 0 to change, 0 to destroy`

### Apply result

Completed successfully.

- Apply command root: `infra/terraform/bootstrap`
- Apply result: `2 added, 0 changed, 0 destroyed`
- Created/confirmed state bucket: `palette-staging-tfstate-palette503123`
- Bucket location: `US-CENTRAL1`
- Uniform bucket-level access: enabled
- Public access prevention: enforced
- Versioning: enabled
- Soft delete policy: Google default retention observed as 7 days
- Storage API: `storage.googleapis.com` enabled

### Bootstrap follow-up

After successful apply, migrate `infra/terraform/staging` to the GCS backend
using bucket `palette-staging-tfstate-palette503123` and prefix `staging`
before applying staging resources.

## 2026-07-22 — Migrate staging Terraform to GCS backend

### Backend migration intent

Move the Phase 06 staging Terraform root from an unmaterialized local backend
to the private GCS state bucket before planning or applying staging resources.

### Configuration

| Field | Value |
| --- | --- |
| Terraform root | `infra/terraform/staging` |
| Backend | `gcs` |
| Bucket | `palette-staging-tfstate-palette503123` |
| Prefix | `staging` |
| Remote state object | `staging/default.tfstate` |

### Remote actions

- Ran `terraform init -migrate-state -force-copy` against the configured GCS
  backend.
- Terraform created the initial remote state object.
- Remote state is reachable through Terraform and has a valid lineage.
- Initial remote state serial is `1`, with zero managed resources and zero outputs.

### Servers / CPU / service impact

None. This migration created no APIs, service accounts, buckets beyond the
existing state bucket, queues, secrets, servers, CPUs, Cloud Run services,
schedulers, or public endpoints.

### Backend migration budget / alert impact

None. Budget remains disabled at `$0`; no alert resource was created. The
recorded future alert email remains `nizar.main01@gmail.com`.

### Validation

- `terraform fmt -check`: passed
- `terraform init`: GCS backend configured successfully
- `terraform validate`: passed
- `terraform state pull`: passed
- Remote state object confirmed in GCS

### Backend migration follow-up

Generate and review the additive staging foundation plan. Do not apply it
without owner approval.

## 2026-07-22 — Review staging foundation plan

### Foundation plan intent

Generate a plan against the remote GCS state and record every proposed remote
change. This is a plan-only checkpoint; no infrastructure is applied.

### Plan validation

- `terraform fmt -check`: passed
- `terraform validate`: passed
- `terraform plan -detailed-exitcode`: returned `2`, meaning changes exist
- Proposed result: `29 to add, 0 to change, 0 to destroy`
- Destructive or replacement actions: none
- Remote state remains empty before apply
- Local plan SHA-256:
  `7b24abe3feb6d90bb9765f28b84203378e4377a41f189b91ceaf3ecf1282dfa1`
- The local plan is not committed and must be regenerated before any apply.

### Proposed APIs

The plan enables or adopts management of these 15 project services:

- Artifact Registry
- Billing Budgets
- Cloud Build
- Cloud Scheduler
- Cloud Tasks
- Firestore
- IAM
- IAM Service Account Credentials
- Identity Toolkit
- Cloud Logging
- Cloud Monitoring
- Cloud Run
- Secret Manager
- Service Usage
- Cloud Storage

Enabling an API does not create its runtime resource by itself.

### Proposed identities and IAM

The plan creates four service accounts:

- `palette-api-runtime`
- `palette-worker-runtime`
- `palette-tasks-invoker`
- `palette-scheduler-invoker`

It also proposes five narrow resource-level IAM memberships for input objects,
artifact objects, and worker-only OpenRouter secret access.

### Proposed storage

- `palette-staging-input-palette503123`
  - regional location `US-CENTRAL1`;
  - private with uniform access and public access prevention;
  - `force_destroy = false` and versioning disabled;
  - object deletion after one day;
  - current draft CORS origin is wildcard `*`.
- `palette-staging-artifacts-palette503123`
  - regional location `US-CENTRAL1`;
  - private with uniform access and public access prevention;
  - `force_destroy = false` and versioning enabled;
  - object deletion after seven days;
  - current draft CORS origin is wildcard `*`.

### Proposed Artifact Registry, queue, and secret metadata

- Docker repository `palette-containers` in `us-central1`.
- Cloud Tasks queue `palette-jobs` in `us-central1`:
  - maximum three concurrent dispatches;
  - maximum one dispatch per second;
  - three attempts over at most 1,800 seconds;
  - backoff from 10 to 300 seconds.
- Secret Manager secret metadata `palette-openrouter-api-key`.
- No secret value or secret version is included in Terraform.

### Foundation plan servers / CPU impact

No Cloud Run service, VM, container, server, or CPU configuration is included.
Those settings remain deferred until the Phase 03–05 services and container
entry points are implementation-ready.

### Foundation plan budget / alert impact

- Budget amount remains `$0`.
- No billing budget or monitoring alert resource is included.
- `nizar.main01@gmail.com` is recorded but is not bound to a remote resource.
- No alert-verification email will be sent by this plan.

### Gaps found during review

The current foundation draft intentionally or incompletely omits:

- Firestore Native database creation, indexes, TTL, backup, and PITR choice;
- build, deploy, and Terraform automation identities;
- Identity Platform provider and authorized-domain configuration;
- Cloud Scheduler reconciliation job;
- dashboards, monitoring policies, and verified notification channels;
- Cloud Run API/worker services and their CPU, memory, timeout, scaling, and
  invocation IAM;
- a billing budget, because the approved initial amount is zero.

The wildcard bucket CORS origins are also broader than the least-privilege
launch target. The staging Cloud Run origin is not available yet.

### Foundation plan decision gate

Do not apply this draft yet. Before apply, decide whether to:

1. remove bucket CORS rules until the staging origin exists;
2. add the build, deploy, and Terraform service-account identities now;
3. create the Firestore Native database now or defer it until Phase 03 is
   implementation-ready.

After owner approval, update the Terraform and this plan record, regenerate the
plan, review it, and request separate apply approval.

## 2026-07-22 — Revise staging foundation plan

### Owner-approved revision

The owner approved the recommended safe foundation scope:

- remove wildcard bucket CORS until the real staging origin exists;
- add dedicated build, deploy, and Terraform automation identities;
- defer Firestore database creation until Phase 03 is implementation-ready;
- keep application-dependent services and budget resources deferred.

### Terraform changes

- Removed both bucket CORS blocks. The buckets remain private, and browser
  signed-URL access will not be enabled until an exact origin is known.
- Added `palette-build` with no roles or keys.
- Added `palette-deploy` with no roles or keys.
- Added `palette-terraform` with no roles or keys.
- Added outputs for the three automation identity email addresses.

Roles, `actAs` permissions, federation, and pipeline access remain deferred
until the delivery pipeline is designed and reviewed.

### Revised plan validation

- `terraform fmt`: passed
- `terraform validate`: passed
- Proposed result: `32 to add, 0 to change, 0 to destroy`
- Destructive, update, and replacement actions: none
- Service accounts proposed: seven
- Bucket CORS blocks proposed: zero
- Revised local plan SHA-256:
  `5fd6c3406ba69a597c28676994855d988b3da4a24ad8efa4fd2c4e63c7f2d0e5`
- The earlier plan and SHA-256 are superseded.
- The local plan is not committed and must be regenerated before apply.

### Revised servers / CPU / service impact

No Cloud Run service, VM, server, container, CPU, scheduler job, or Firestore
database is included. The plan still proposes the documented APIs, private
buckets, Artifact Registry repository, Cloud Tasks queue, Secret Manager
metadata, IAM memberships, and seven service accounts.

### Revised budget / alert impact

The Terraform budget setting remains `$0`. No budget, alert, or notification
channel is included, and the plan creates no new email binding. The operator
email already has project Owner access independently of this plan.

### Revised plan apply gate

No remote infrastructure was changed while revising the plan. Apply the
foundation only after separate owner approval of the revised 32-resource plan.

## 2026-07-22 — Staging foundation apply interrupted

### Approved apply gate

Immediately before apply, Terraform regenerated the plan and verified exactly
`32 to add, 0 to change, 0 to destroy`. The saved plan SHA-256 was:

`914dff30374671fe3bea5845f85e34d0bf973c35d6dfc14afa2eaa68589b5aeb`

Terraform applied that exact saved plan.

### Failure

The apply stopped with HTTP 403 errors because
`cloudresourcemanager.googleapis.com` was disabled. The Google provider could
not finish reading or editing several project services until that prerequisite
API is enabled and propagated.

No automatic workaround or unapproved configuration change was attempted.

### Partial apply reconciliation

The apply completed the approved API-management portion before stopping:

- Remote state advanced from serial `1` to serial `2`.
- Terraform state contains 15 `google_project_service` instances.
- All 15 approved APIs are now enabled.
- The GCS state object has two retained versions.
- No Palette service accounts were created.
- No input or artifact bucket was created.
- No Artifact Registry repository was created.
- No Cloud Tasks queue was created.
- No Secret Manager secret was created.
- No planned Palette IAM membership was created.
- API activation automatically created Google-managed Cloud Tasks and Cloud
  Scheduler service-agent IAM bindings.

The `depends_on` gate prevented downstream foundation resources from being
created while API initialization was incomplete.

### Interrupted apply servers / CPU impact

No Cloud Run service, VM, server, container, CPU, scheduler job, or Firestore
database was created.

### Interrupted apply budget / alert impact

This Terraform apply created no Palette budget, Monitoring alert, notification
channel, or new email binding. The Terraform budget setting remains `$0`.

The billing account already contains an independently managed, account-wide
`Portfolio` budget with:

- specified amount CAD `$0`;
- no project filter;
- thresholds at 50%, 90%, and 100%;
- default IAM recipients enabled;
- no Pub/Sub notification topic.

The operator email already has project Owner access. That role is not a new
budget or monitoring notification binding from this apply.

### Root-cause correction proposal

1. Add `cloudresourcemanager.googleapis.com` to Terraform
   `required_services`, inheriting `disable_on_destroy = false`, validate it,
   and commit that correction before changing remote state.
2. After owner approval, enable that one API as an explicit bootstrap action
   using the configured account and `--project=palette-503123`.
3. Wait for API propagation and verify it is enabled.
4. Reconfirm remote state serial `2` before planning.
5. Regenerate the Terraform plan. Expect approximately 18 additive actions:
   the 17 remaining approved foundation resources plus management of the
   bootstrap API.
6. Continue only if the recovery plan is additive and contains no unexpected
   changes or destroys.
7. Record the exact recovery plan and request approval before applying it.

### Recovery permission gate

Do not perform the bootstrap correction or retry Terraform until the owner
approves this revised recovery plan.

## 2026-07-22 — Bootstrap correction completed; taint detected

### Approved Cloud Resource Manager correction

- Added `cloudresourcemanager.googleapis.com` to Terraform
  `required_services`.
- The resource inherits `disable_on_destroy = false`.
- Terraform formatting and validation passed.
- Committed the correction before changing GCP.
- Enabled only `cloudresourcemanager.googleapis.com` using the explicit owner
  account and `--project=palette-503123`.
- The enable operation completed successfully.
- Verified the Cloud Resource Manager v3 project endpoint with ADC and the
  staging quota project; the project returned `ACTIVE`.

The first plan attempt occurred during service propagation and received the
same 403 response. It made no state change. Planning was retried only after the
actual API endpoint succeeded.

### Rejected recovery plan

The propagated recovery plan did not pass the no-destroy gate:

- 18 create actions;
- 9 no-op actions;
- 6 destroy-and-create replacement actions;
- no remote apply was attempted;
- remote state remains serial `2` with 15 API instances.

The rejected local plan SHA-256 is:

`61ee91bd67e6a5681596ed5c413f4329c86e07b9c4db51cefcc1b69a3fcb2f26`

### Tainted state findings

The interrupted apply marked these six Terraform state instances as tainted:

- `billingbudgets.googleapis.com`;
- `cloudscheduler.googleapis.com`;
- `cloudtasks.googleapis.com`;
- `firestore.googleapis.com`;
- `identitytoolkit.googleapis.com`;
- `secretmanager.googleapis.com`.

All six APIs are currently enabled in GCP. Their replacements are state-driven,
not configuration changes. Applying the rejected plan would violate the
project's no-destroy gate even though `disable_on_destroy = false` would keep
the APIs enabled.

### Taint recovery proposal

- **Step 1:** Immediately before mutation, pull a temporary state backup,
  restrict it to owner-only file permissions, and verify lineage, serial `2`,
  15 instances, and its SHA-256. Never commit the backup.
- **Step 2:** With normal Terraform state locking enabled, run
  `terraform untaint` for only these exact quoted addresses:

```text
google_project_service.required["billingbudgets.googleapis.com"]
google_project_service.required["cloudscheduler.googleapis.com"]
google_project_service.required["cloudtasks.googleapis.com"]
google_project_service.required["firestore.googleapis.com"]
google_project_service.required["identitytoolkit.googleapis.com"]
google_project_service.required["secretmanager.googleapis.com"]
```

- **Step 3:** Record each successful untaint and the final state serial. Stop
  and reconcile if execution is interrupted.
- **Step 4:** Verify all six APIs and Cloud Resource Manager remain enabled.
- **Step 5:** Verify the remote state contains no tainted instances and no
  downstream resources.
- **Step 6:** Regenerate the Terraform plan.
- **Step 7:** Require exactly 18 creates, 15 no-ops, and zero update,
  replacement, or destroy actions. Review all 18 resource identities.
- **Step 8:** Document the exact plan and request separate apply approval.
- **Step 9:** Delete the temporary backup after the recovery evidence is
  recorded. Do not restore it with `terraform state push` without separate
  review and approval.

`terraform untaint` changes Terraform's remote state status only; it does not
disable, recreate, or otherwise modify the corresponding GCP APIs.

### Taint recovery permission gate

Do not mutate remote Terraform state or retry the foundation apply until the
owner approves this state-only recovery.

## 2026-07-22 — Taint recovery completed and plan approved for review

### State backup and preconditions

The owner approved the state-only recovery.

- Pulled the remote state to a temporary file outside the repository.
- Restricted the backup to mode `0600`.
- Verified the lineage was present.
- Verified serial `2`, 15 API instances, and exactly six taints.
- Backup SHA-256:
  `d9684883fe89d592ae4211a5b253631f17300daa75b8e863c5a0260f57f64da9`

### Untaint execution

With normal Terraform locking enabled, each of the six exact API addresses was
successfully untainted. No command was interrupted or retried.

### State recovery result

- Lineage remained unchanged.
- Remote state advanced from serial `2` to serial `8`.
- State still contains exactly 15 `google_project_service` instances.
- Tainted instances: zero.
- Downstream foundation resources in state: zero.
- GCS retained state-object versions: eight.
- Post-recovery state SHA-256:
  `12cc342c91a8bec81770e9b97c1770c9729c20eb3a153e51dc0a7b7c5538495a`
- All six recovered APIs and Cloud Resource Manager remain enabled.
- No Palette service accounts, application buckets, Artifact Registry
  repository, Tasks queue, or Palette secret exists remotely.

This was a Terraform state-status correction only. It made no change to the
corresponding GCP API enablement.

### Strict recovery plan result

Terraform regenerated the plan against state serial `8` and passed the exact
gate:

- 18 create actions;
- 15 no-op actions;
- zero updates;
- zero replacements;
- zero destroys.

The 18 proposed creates are:

- Terraform management of the already-enabled Cloud Resource Manager API;
- seven Palette service accounts;
- two private regional application buckets;
- four bucket IAM memberships;
- one Artifact Registry repository;
- one Cloud Tasks queue;
- one Secret Manager secret metadata resource;
- one worker-only secret IAM membership.

The plan still contains no Cloud Run service, VM, server, container, CPU,
Firestore database, scheduler job, billing budget, Monitoring alert, or
notification channel. Bucket CORS remains absent, and no secret value is
included.

Recovery plan SHA-256:

`4b032a4b7bffe1078a04d2fc9b7f7024335d019e97359ac019daa05c2430aaca`

The local plan is not committed and must be regenerated with the same exact
action gate immediately before apply.

### Temporary evidence cleanup

The initial cleanup removed the dedicated pre-recovery and post-recovery state
files. Independent review then found older diagnostic snapshots and saved plan
artifacts from earlier steps.

Removed all 42 session-created `/tmp/palette-*` artifacts, including state
snapshots, saved plans, plan JSON, and logs. Verification found zero remaining
Palette temporary artifacts and no saved plan that could bypass the required
regeneration gate. `terraform state push` was not used.

### Recovered foundation apply gate

No foundation apply was performed. Request separate owner approval before
applying the recovered 18-create plan.

## 2026-07-22 — Recovered staging foundation applied

### Final apply gate

The owner approved the recovered foundation apply. Immediately before apply,
Terraform verified:

- state serial `8` with 15 instances and zero taints;
- all prerequisite APIs enabled;
- exactly 18 creates and 15 no-ops;
- zero updates, replacements, or destroys.

The exact saved plan applied had SHA-256:

`71ddcdec8b0c19ced207a08004fbcc4bb72878256ad043f643e40d62d0a4efa2`

### Recovered foundation apply result

Terraform applied the exact gated plan successfully:

`18 added, 0 changed, 0 destroyed`

Remote state advanced to serial `10` with 33 managed instances and zero
taints. A fresh post-apply plan returned exit code `0` and reported no drift.

### Enabled APIs

Terraform now manages all 16 required foundation APIs, including Cloud Resource
Manager. Verification found all 16 enabled.

### Service accounts and keys

Created seven enabled service accounts:

- `palette-api-runtime`;
- `palette-worker-runtime`;
- `palette-tasks-invoker`;
- `palette-scheduler-invoker`;
- `palette-build`;
- `palette-deploy`;
- `palette-terraform`.

All seven have zero user-managed service-account keys. The build, deploy, and
Terraform identities have no project roles yet.

### Application buckets

Created `palette-staging-input-palette503123`:

- regional location `US-CENTRAL1`;
- public access prevention enforced;
- uniform bucket-level access enabled;
- versioning disabled;
- object deletion lifecycle after one day;
- CORS rules absent;
- Google default soft-delete retention observed as seven days;
- API runtime has object-admin access;
- worker runtime has object-viewer access.

Created `palette-staging-artifacts-palette503123`:

- regional location `US-CENTRAL1`;
- public access prevention enforced;
- uniform bucket-level access enabled;
- versioning enabled;
- object deletion lifecycle after seven days;
- CORS rules absent;
- Google default soft-delete retention observed as seven days;
- worker runtime has object-admin access;
- API runtime has object-viewer access.

### Bucket IAM observation

Google initialized both application bucket policies and the Terraform state
bucket policy with legacy convenience bindings for project Owner, Editor, and
Viewer basic roles. Uniform bucket-level access removes object ACLs but does
not remove those IAM convenience bindings.

The default Compute service account currently has project `roles/editor`.
Consequently, it can reach application objects and remote Terraform state
outside the explicit Palette runtime grants. This is actionable security debt.

Harden the default service account and all three bucket policies before staging
handles user data. Do not remove access without a separate impact and lockout
review.

### Artifact Registry

Created the empty Docker repository `palette-containers` in `us-central1` as a
standard repository using Google-managed encryption. Current repository size
is zero.

Container Analysis and On-Demand Scanning APIs are currently disabled, so image
vulnerability scanning is not yet configured. Resolve the scanning and cost
policy before publishing images.

### Cloud Tasks

Created running queue `palette-jobs` in `us-central1` with:

- maximum three concurrent dispatches;
- maximum one dispatch per second;
- maximum three attempts;
- maximum retry duration 1,800 seconds;
- minimum backoff 10 seconds;
- maximum backoff 300 seconds;
- maximum five backoff doublings;
- server-calculated burst size 10;
- Cloud Logging sampling ratio 1.0.

No tasks were created.

### Secret Manager

Created secret metadata `palette-openrouter-api-key` with automatic replication
and worker-only `roles/secretmanager.secretAccessor`. Secret versions remain
zero, so no OpenRouter value was supplied through this workflow.

### Servers / CPU / application services

No Cloud Run service, VM, server, container, CPU configuration, Firestore
database, scheduler job, or public endpoint exists. Those remain deferred to
the implementation-ready application phases.

### Budget / alert status

Terraform created no budget, Monitoring alert, notification channel, or new
email binding. The Terraform budget setting remains `$0`.

The independently managed account-wide `Portfolio` budget remains CAD `$0`
with no project filter. The future application alert email remains
`nizar.main01@gmail.com`.

### Recovered apply evidence cleanup

Removed the five apply artifacts after committing the evidence. Read-only
security verification later created one additional diagnostic file, which was
also deleted. Final verification found zero `/tmp/palette-*` artifacts and no
saved plan that could bypass the regeneration gate.

### Bootstrap state handling

`infra/terraform/bootstrap/terraform.tfstate` exists locally but is ignored and
is not tracked by Git. It contains the state-bucket bootstrap metadata. Migrate
this bootstrap state to a protected remote prefix before deleting the local
file.

### Pre-workload security gate

Before introducing images, workloads, secrets, or user data, prepare and obtain
approval for a separate hardening plan covering:

- bootstrap-state migration to the GCS backend;
- removal or disabling of the default Compute service account's Editor access;
- authoritative least-privilege IAM for the state and application buckets;
- explicit operator and Terraform state access that prevents lockout;
- Artifact Registry vulnerability-scanning policy and cost impact.

### Foundation checkpoint

The additive initial staging foundation is applied and drift-free. Phase 06 is
not complete: application-dependent infrastructure, security tests, monitoring,
budgets, delivery pipeline, and deployed smoke tests remain outstanding.

## 2026-07-22 — Security hardening plan prepared

### Plan-only authorization

The owner authorized preparation of a security-hardening plan only. No IAM,
state, API, service-account, repository, budget, or runtime setting was changed.

Created
[`gcp-staging-security-hardening-plan.md`](./gcp-staging-security-hardening-plan.md)
for the pre-workload gate.

### Read-only findings

- Bootstrap state is local, ignored, and not tracked by Git.
- Bootstrap state is serial `3` with two instances.
- No remote `bootstrap/default.tfstate` exists.
- The default Compute service account is the sole project Editor.
- No default-account activity was found in the available 90-day log query.
- No VM or Cloud Run service is attached to that account.
- All three buckets retain Owner, Editor, and Viewer convenience values.
- The application buckets retain the intended four runtime grants.
- The automatic and on-demand scanning APIs are disabled.
- The container repository remains empty.

### Cost finding

Published standard automatic-scanning pricing is USD `$0.26` for the initial
scan of each unique image digest. The Terraform budget setting remains `$0`, so
scanning stays disabled until owner approval of a non-zero allowance or
explicit per-build spend.

### Planned hardening order

1. Migrate bootstrap state to the versioned GCS backend.
2. Establish explicit state-bucket operator and Terraform access.
3. Replace application-bucket convenience IAM with authoritative policies.
4. Canary-disable the default Compute account, which has no observed activity
   or VM/Cloud Run attachment, then separately remove Editor after broader
   inventory and approval.
5. Configure image scanning only after the cost decision.
6. Run positive and negative IAM validation before workloads or user data.

Each step has a separate owner approval and micro-commit gate.

### Plan-only temporary evidence cleanup

Completed after committing the reviewed plan. Removed the temporary provider
schema used for capability inspection. Verification found zero
`/tmp/palette-*` or `/tmp/security-*` artifacts. No applyable Terraform plan
was created.

## 2026-07-23 — Hardening plan corrected after review

### Review authorization

The owner supplied five plan findings. The plan was corrected without changing
GCP, Terraform state, IAM, APIs, budgets, repository settings, or workloads.

### Corrections

- H3 now replaces the four additive bucket IAM declarations with two
  authoritative policy declarations in the same commit. It then removes only
  the four obsolete state addresses and requires exactly two policy creates.
- H4 records that disabling a service account is immediate and rejects existing
  tokens. The canary now lasts at least 24 hours and covers the longest known
  scheduled or event-driven consumer cadence before Editor removal.
- H5 defines a fail-closed exact-digest scan contract with terminal success,
  bounded timeout, missing/error/stale rejection, evidence capture, and a
  named, expiring digest-specific exception process.
- H5 declares repository automatic-scanning inheritance in Terraform with
  `vulnerability_scanning_config` rather than relying on console state.
- H6 defines queue IAM: API enqueuer, operator queue administrator, Terraform
  queue administrator, and explicit denial expectations for all other
  identities.

### Read-only verification

- The current queue IAM policy is empty.
- Terraform supports queue IAM member, binding, and policy resources.
- Terraform supports Artifact Registry `vulnerability_scanning_config` with
  `enablement_config`.
- Cloud Tasks role permissions were checked for Enqueuer, Viewer, Queue Admin,
  Task Deleter, Task Runner, and Admin.
- Published on-demand scanning pricing is recorded as USD `$0.26` per
  invocation and remains behind owner spend approval.

### Review-revision temporary cleanup

Completed after committing the corrected plan. Removed the temporary provider
schema and verified zero `/tmp/hardening-*`, `/tmp/palette-*`, or
`/tmp/security-*` artifacts. No applyable Terraform plan was created.

## 2026-07-23 — Scanning exception expiry made operational

A final plan review found that a 24-hour exception could expire on paper while
its image remained deployed. H5 now treats expiry as an enforced deployment
event:

- store digest, expiry, rollback digest, approval, and reason in machine-readable
  deployment state;
- check expiry on every promotion/deployment and at least every five minutes;
- require a clean replacement or explicit reviewed renewal before expiry;
- block further promotion automatically at expiry;
- roll back to the last clean digest, or undeploy when no clean digest exists;
- escalate through a documented security incident when remediation fails;
- require a new expiring emergency exception for any continued operation;
- prohibit silent continued operation.

This was a documentation-only correction. No GCP, Terraform state, IAM,
scanning, budget, image, or workload setting changed.

## 2026-07-23 — Bootstrap GCS backend prepared

### H1 preparation authorization

Work was limited to the local, plan-only preparation step for H1. The files
modified by this step were clean before editing. A pre-existing untracked
`prodPlans/phases/06-staging-infrastructure.md` was observed in the read-only
scope and was left untouched and unstaged.

Read-only inspection confirmed that
`infra/terraform/bootstrap/terraform.tfstate` remains local, ignored, and not
tracked by Git. It is serial `3`, has a lineage, contains exactly the two
expected instances, and has zero taints:

- `google_project_service.storage`;
- `google_storage_bucket.terraform_state`.

### Backend configuration

Added a committed GCS backend declaration to `infra/terraform/bootstrap`:

| Field | Value |
| --- | --- |
| Backend | `gcs` |
| Bucket | `palette-staging-tfstate-palette503123` |
| Prefix | `bootstrap` |
| Future remote state object | `bootstrap/default.tfstate` |

### Safe local validation

- `terraform fmt -check -diff` passed for the bootstrap root.
- A temporary copy of the bootstrap configuration was initialized with
  `terraform init -backend=false -input=false`; the configured GCS backend was
  not initialized or contacted.
- `terraform validate -json` passed in that isolated copy with zero errors and
  zero warnings.
- The temporary validation directory and captured command output were removed.
- `terraform init -migrate-state` was not run in any directory.

### Remote effect and next permission gate

This preparation made no GCP API call, contacted no Terraform backend, and
created or modified no remote resource, Terraform state, IAM policy, API,
budget, image, workload, secret, or user data.

The future approved migration is expected to create one additional versioned
state object at `bootstrap/default.tfstate` and make no GCP resource creation,
update, or destruction. Before that migration, H1 requires a mode `0600` local
backup and SHA-256, local lineage/serial/instance verification, state-bucket
security and metageneration checks, and target-object absence verification.
The repository mount reports mode `0777` for the current local state, so the
backup must be created outside the repository on a filesystem that enforces
mode `0600`, and that mode must be verified before continuing. After separate
owner approval, target absence and bucket metageneration must be rechecked
immediately. Any changed precondition or unexpected remote object
stops all bootstrap and staging Terraform commands for separately reviewed
split-brain reconciliation; `-force-copy` is not retried and `terraform state
push` is not used as an automatic rollback.

The next permission gate is explicit owner approval for the safeguarded H1
state-migration procedure. Backend migration remains unauthorized by this
preparation entry.

## 2026-07-23 — Bootstrap state migration preflight completed

### Preflight authorization and scope

The owner authorized the read-only H1 migration preflight. This authorization
did not authorize `terraform init -migrate-state`, remote state creation, or
any GCP resource, IAM, API, budget, image, workload, secret, or user-data
change.

### Local state and protected backup

Read-only local verification passed:

- state serial: `3`;
- lineage: present;
- managed instances: exactly `2`;
- taints: `0`;
- addresses: `google_project_service.storage` and
  `google_storage_bucket.terraform_state`.

A byte-identical backup was created outside the repository on the `/tmp`
filesystem and is intentionally retained through migration validation:

- file mode: verified `0600`;
- filesystem reported by `stat`: `ext2/ext3`;
- SHA-256:
  `15aeed336429c744c7f16111526c07921bbecf66e1f7a6b2918773cfcfd5e4ea`;
- source and backup SHA-256 values matched.

The backup contains Terraform state and must not be committed or displayed. It
will be deleted only after the migrated remote state is pulled and validated
and the migration documentation is committed.

### Read-only GCP preflight

Queries ran as the active owner account against configured project
`palette-503123`. No write, apply, migration, or Terraform backend command ran.

The bucket-description and bucket-IAM queries were each executed three times.
The first local parser expected nested JSON fields and stopped before the
object check; the second query inspected the actual top-level `gcloud storage`
field names; the corrected third query completed validation. This was a local
output-shape reconciliation only. All six GCP operations were read-only and
returned the same bucket; no remote setting changed.

Final verified state-bucket settings:

| Field | Value |
| --- | --- |
| Bucket | `palette-staging-tfstate-palette503123` |
| Location | `US-CENTRAL1` |
| Uniform bucket-level access | enabled |
| Public access prevention | enforced |
| Versioning | enabled |
| IAM bindings | `4` |
| Public principals | `0` |
| Bucket metageneration | `1` |

One read-only object-description request confirmed that
`bootstrap/default.tfstate` is absent. Temporary JSON and stderr evidence from
the GCP queries was removed after the summarized settings were recorded. The
mode-`0600` state backup remains intentionally retained.

### Final migration permission gate

Bootstrap migration is still unauthorized. Separate explicit owner approval is
required immediately before migration. After that approval, recheck that:

- `bootstrap/default.tfstate` remains absent;
- bucket metageneration remains exactly `1`;
- the retained backup remains mode `0600` and its SHA-256 remains
  `15aeed336429c744c7f16111526c07921bbecf66e1f7a6b2918773cfcfd5e4ea`;
- local state remains serial `3`, has the same lineage and two instances, and
  has zero taints.

Stop before migration if any value changed or if the target object appears.
Only if every immediate recheck passes may the locked
`terraform init -migrate-state -force-copy` run. Any migration failure or
unexpected remote object invokes the H1 split-brain stop rule: preserve both
copies, stop bootstrap and staging Terraform commands, and obtain a separately
reviewed recovery plan without retrying `-force-copy` or automatically using
`terraform state push`.

## 2026-07-23 — Bootstrap state migrated; verification paused

### Execution authorization and immediate gates

The owner instructed that, if the target remained absent after the approved
preflight gates, the approved migration procedure should run. Immediately
before migration, all required gates passed:

- local state remained serial `3`, with the expected lineage, two instances,
  and zero taints;
- the protected backup remained mode `0600`, retained the recorded SHA-256,
  and remained byte-identical to the local state;
- bucket metageneration remained `1`, with uniform access, public-access
  prevention, and versioning unchanged;
- `bootstrap/default.tfstate` remained absent.

These immediate checks used one read-only bucket-description request and one
read-only absent-object request. Their temporary output was removed.

### Migration command and isolated provider runtime

To avoid the unhealthy Google provider cache on the `/mnt/d` mount, Terraform
runtime data was placed in a mode-`0700` directory on the Linux `/tmp`
filesystem. The mounted `.terraform` provider cache was not used or modified.

The locked migration ran once with:

```text
TF_DATA_DIR=<mode-0700 Linux temporary directory> terraform \
  -chdir=infra/terraform/bootstrap init \
  -migrate-state -force-copy -input=false -lockfile=readonly -no-color
```

The command returned exit code `0`, configured the GCS backend successfully,
and installed the dependency-lock-file version of the signed Google provider,
`7.40.0`, in the isolated Linux runtime directory. It did not run `apply` or
change any deployed GCP resource, IAM policy, API, budget, image, workload,
secret, or user data.

### Verification divergence and stop

A read-only `terraform state pull` completed against the migrated backend. The
verification script then stopped because it had required remote serial `3`,
while Terraform wrote current remote serial `4`. No `validate`, `plan`, second
migration, `terraform state push`, or further bootstrap/staging Terraform
command ran after that assertion.

Reconciliation used read-only local inspection and GCP object queries only. It
found:

- current remote lineage matches the protected serial-`3` backup;
- remote resources, outputs, two instances, and zero-taint status exactly match
  the backup;
- only the state serial differs: backup `3`, current remote `4`;
- `bootstrap/default.tfstate` is one object key with two retained generations:
  - an initial `181`-byte empty state at serial `1` with zero resources;
  - the current `5824`-byte migrated state at serial `4` with two instances;
- bucket metageneration remains `1` and versioning remains enabled;
- no `bootstrap/default.tflock` object remains;
- the repository's local `terraform.tfstate` is now a zero-byte file;
- Terraform created `terraform.tfstate.backup`, mode `0777` on the mounted
  filesystem, whose bytes and SHA-256 exactly match the protected mode-`0600`
  backup.

The two generations are consistent with backend initialization first
materializing an empty state and then writing the migrated state, and the
serial increment is consistent with the migration write. However, serial `4`
and Terraform's automatic emptying/backup of the local primary differed from
the strict verification assumption and the planned manual cleanup timing, so
work remains stopped pending independent review and owner approval of a revised
validation plan.

For audit completeness, post-stop reconciliation made one bucket-description
request, one current-object description, two version-list requests, one
read-only request for each of the two object generations, and one absent-lock
object request. Temporary reconciliation files were removed. The protected
backup, pulled remote-state evidence, migration log, isolated Terraform runtime
directory, zero-byte local primary, and Terraform-created local backup are
retained until the revised validation and documentation gates complete.

### Revised validation permission gate

Do not rerun `-force-copy`, migrate state again, run `terraform state push`, or
apply configuration. The proposed continuation is:

1. independently confirm that matching lineage/resources/outputs with the
   serial transition `3` to `4` is a successful migration, not split-brain;
2. use the already initialized Linux `TF_DATA_DIR` to run `terraform validate`;
3. if validation passes, run a non-saved, locked, detailed-exit-code bootstrap
   plan with `terraform.tfvars.example` and require zero drift;
4. verify the lock object is removed and current remote lineage, serial,
   resources, outputs, taints, and object-generation set remain unchanged;
5. document and commit migration validation before deleting any local state or
   retained evidence;
6. only after that commit, remove the zero-byte local primary, mounted
   `terraform.tfstate.backup`, protected backup, pulled state, migration log,
   and isolated runtime directory, then document cleanup separately.

This revised continuation requires separate owner approval. Any lineage,
resource, output, taint, object-generation, or lock anomaly keeps all bootstrap
and staging Terraform commands stopped for a separately reviewed split-brain
recovery plan.

## 2026-07-23 — Bootstrap migration validation passed

### Revised validation authorization

The owner approved the revised validation sequence with these binding
conditions: `terraform plan -detailed-exitcode` must return `0`; exit `1` or
`2` stops the sequence; no saved plan, apply, state push, migration retry, or
`-force-copy`; locking must remain enabled and the transient lock must be gone
afterward; remote serial and object generations must remain unchanged; both
serial-`3` backups must remain until validation evidence is committed; and
cleanup may remove only explicitly inventoried evidence.

The owner also accepted the empty serial-`1` generation followed by current
serial `4`, and Terraform's zeroed local primary plus local backup, as normal
migration behavior rather than split-brain.

### Provider validation

Using the retained mode-`0700` Linux `TF_DATA_DIR` and its signed Google
provider `7.40.0`, `terraform validate -json` returned exit code `0`:

- valid: `true`;
- errors: `0`;
- warnings: `0`.

The mounted `.terraform` cache remained unused and unchanged.

### Locked no-drift plan

Immediately before planning, a read-only backend state pull confirmed current
serial `4`, matching migrated lineage, resources, outputs, two instances, and
zero taints. A read-only all-versions listing confirmed exactly these two
`bootstrap/default.tfstate` generations:

| Size | Generation |
| --- | --- |
| `181` bytes | `1784786498188509` |
| `5824` bytes | `1784786498859072` |

The approved plan ran without `-out`:

```text
TF_DATA_DIR=<retained mode-0700 Linux directory> terraform \
  -chdir=infra/terraform/bootstrap plan \
  -detailed-exitcode -lock=true -lock-timeout=0s -input=false -no-color \
  -var-file=terraform.tfvars.example
```

Result:

- detailed exit code: `0`;
- Terraform result: `No changes. Your infrastructure matches the
  configuration.`;
- saved plan: none;
- apply: not run.

The plan refreshed only the two bootstrap resources. Other than the GCS
backend's transient state-lock operation, validation was read-only and created,
updated, or destroyed no GCP resource, Terraform state, IAM policy, API,
budget, image, workload, secret, or user data.

### Mandatory postchecks

Post-plan verification ran even though the plan returned `0`:

- a second backend state pull matched the pre-plan lineage, serial `4`,
  resources, outputs, and zero-taint status exactly;
- a second all-versions listing matched the same two generation IDs and sizes
  byte-for-byte;
- `bootstrap/default.tflock` was absent after planning;
- both the protected mode-`0600` backup and mounted
  `terraform.tfstate.backup` retained SHA-256
  `15aeed336429c744c7f16111526c07921bbecf66e1f7a6b2918773cfcfd5e4ea`;
- no saved plan was created;
- no apply, state push, migration retry, or `-force-copy` ran.

Remote read activity for this validation consisted of the pre-plan and
post-plan backend pulls, two all-version listings, provider refresh reads for
the two managed bootstrap resources, and one post-plan absent-lock object
request. No unexpected result occurred.

### Explicit cleanup inventory and gate

The following evidence is intentionally retained until this validation entry
is independently reviewed and committed:

1. `infra/terraform/bootstrap/terraform.tfstate` — zero-byte local primary;
2. `infra/terraform/bootstrap/terraform.tfstate.backup` — Terraform-created
   serial-`3` backup on the mounted filesystem;
3. `/tmp/palette-bootstrap-h1-pre-migration.tfstate` — protected mode-`0600`
   serial-`3` backup;
4. `/tmp/palette-bootstrap-h1-remote-pull.tfstate` — first migrated-state pull;
5. `/tmp/palette-bootstrap-h1-init.log` — migration initialization log;
6. `/tmp/palette-bootstrap-h1-tfdata` — isolated Linux Terraform runtime data;
7. `/tmp/palette-bootstrap-h1-validate.json` — validation output;
8. `/tmp/palette-bootstrap-h1-pre-plan-pull.tfstate` — pre-plan state pull;
9. `/tmp/palette-bootstrap-h1-post-plan-pull.tfstate` — post-plan state pull;
10. `/tmp/palette-bootstrap-h1-pre-plan-generations.txt` — pre-plan versions;
11. `/tmp/palette-bootstrap-h1-post-plan-generations.txt` — post-plan versions;
12. `/tmp/palette-bootstrap-h1-plan.log` — non-saved plan output.

After this validation evidence is committed, cleanup is authorized for exactly
these twelve paths and nothing else. The pre-existing mounted `.terraform`
cache and all unrelated working-tree files are explicitly outside cleanup
scope. Cleanup completion must be verified and documented separately.

## 2026-07-23 — Bootstrap migration evidence cleaned up

The independently reviewed migration-validation evidence was committed before
cleanup in commit `40595c6` (`docs: record bootstrap state migration`).

Cleanup then removed exactly the twelve inventoried paths above:

- the zero-byte local `terraform.tfstate`;
- the mounted `terraform.tfstate.backup`;
- the protected serial-`3` backup;
- all retained state pulls, generation listings, validation output, migration
  log, plan log, and isolated Linux `TF_DATA_DIR`.

Post-cleanup verification found:

- zero of the twelve inventory paths remain;
- zero `/tmp/palette-bootstrap-h1-*` paths remain;
- no saved plan remains;
- the committed bootstrap GCS backend configuration remains present;
- the pre-existing mounted `.terraform` cache remains present and untouched;
- unrelated working-tree files remain untouched and unstaged.

Cleanup made no GCP API call, Terraform backend call, or remote change. The last
committed validation remains the authoritative checkpoint: remote serial `4`,
the same two versioned object generations, no drift, and no retained lock.

H1 is complete: bootstrap state is remote, versioned, validated, and no local
bootstrap state or migration evidence remains. Future bootstrap commands must
be safely reinitialized and must not rely on the known-unhealthy mounted
provider cache. H2 or any other hardening work requires a separate owner gate.

## 2026-07-23 — H2 reinitialization and read-only preparation

### Authorization and local preconditions

The owner authorized the next H2 preparation and safe bootstrap
reinitialization. This did not authorize Terraform configuration changes, an
IAM plan, apply, policy replacement, state mutation, service-account change, or
any other remote write.

Preconditions passed:

- the committed backend still targets bucket
  `palette-staging-tfstate-palette503123` and prefix `bootstrap`;
- no local `terraform.tfstate` or `terraform.tfstate.backup` exists;
- the existing mounted `.terraform` cache remains ignored, untouched, and
  excluded because its Google provider startup is unhealthy;
- the dependency lock file remains tracked and pins Google provider `7.40.0`;
- `bootstrap/default.tfstate` exists with the same two retained generations,
  sized `181` and `5824` bytes.

### Safe bootstrap reinitialization

A new mode-`0700` `TF_DATA_DIR` was created on the Linux `/tmp` filesystem. The
bootstrap root was reinitialized exactly once with:

```text
TF_DATA_DIR=<mode-0700 Linux directory> terraform \
  -chdir=infra/terraform/bootstrap init \
  -reconfigure -lockfile=readonly -input=false -no-color
```

The command returned `0`, configured the existing GCS backend, and installed
the dependency-lock-file Google provider. It did not use `-migrate-state` or
`-force-copy`, answer a migration prompt, create local state, or change remote
state or GCP resources.

Validation then passed with `valid: true`, zero errors, and zero warnings. A
read-only backend pull confirmed serial `4`, the expected lineage, exactly two
instances, and zero taints. No `bootstrap/default.tflock` object remained.

Reinitialization remote reads consisted of one preflight state-object
description, one all-versions listing, backend initialization/access, one state
pull, and one absent-lock request. No remote mutation occurred.

### H2 read-only IAM inventory

All queries ran as active operator `nizar.main01@gmail.com` against configured
project `palette-503123`.

Current state-bucket IAM has four convenience-role bindings and no public
principal:

| Role | Members |
| --- | --- |
| `roles/storage.legacyBucketOwner` | `projectEditor:palette-503123`, `projectOwner:palette-503123` |
| `roles/storage.legacyBucketReader` | `projectViewer:palette-503123` |
| `roles/storage.legacyObjectOwner` | `projectEditor:palette-503123`, `projectOwner:palette-503123` |
| `roles/storage.legacyObjectReader` | `projectViewer:palette-503123` |

The exact operator and `palette-terraform` service account do not yet have
explicit state-bucket bindings. The bucket remains at metageneration `1`, with
uniform bucket-level access enabled, public-access prevention enforced,
versioning enabled, and zero public principals.

Operator access checks passed:

- state-bucket IAM was readable;
- bootstrap state content was readable through Terraform at serial `4`;
- staging state content was readable at serial `10`, with 33 instances and zero
  taints;
- the operator remains the sole project Owner;
- the default Compute service account remains the sole project Editor.

`palette-terraform@palette-503123.iam.gserviceaccount.com` exists, is enabled,
has zero user-managed keys, has no service-account IAM bindings, has no project
role, and does not yet grant the operator
`roles/iam.serviceAccountTokenCreator`.

The read-only inventory used one bucket-IAM request, one bucket description,
one bootstrap-object description, three service-account description/key/policy
requests, one staging-state content read, and one project-IAM request. Temporary
query files were removed.

### IAM policy-version reconciliation

A mode-`0600` current-policy snapshot was retained temporarily with SHA-256
`10486a15b1798a401af047d838ff1f07acdf4863821e1ada0d443ec8c8c8c956`. It
contains the etag and four bindings but is explicitly not the fresh apply-time
rollback backup.

The `gcloud storage buckets get-iam-policy` command has no requested-policy-
version flag. A read-only Storage JSON API request with
`optionsRequestedPolicyVersion=3` returned actual policy version `1`, an etag,
four bindings, and zero conditional bindings. The access token and temporary
response were neither logged nor retained.

This is normal IAM behavior: requesting version `3` preserves conditions if
present, while a policy with no conditions correctly returns actual version
`1`. The H2 plan's literal instruction to export a “version-3 policy” was
therefore corrected to require requesting version `3` and preserving the
returned actual version unchanged. No remote behavior or setting diverged; the
local plan wording was overly strict.

### Retained preparation artifacts and stop gate

The following five paths are retained pending documentation review:

1. `/tmp/palette-bootstrap-h2-tfdata` — mode-`0700` initialized Linux runtime;
2. `/tmp/palette-bootstrap-h2-init.log` — mode-`0600` initialization output;
3. `/tmp/palette-bootstrap-h2-validate.json` — mode-`0600` validation output;
4. `/tmp/palette-bootstrap-h2-state-pull.tfstate` — mode-`0600` serial-`4`
   state evidence;
5. `/tmp/palette-bootstrap-h2-current-iam.json` — mode-`0600` non-apply IAM
   snapshot.

H2 configuration implementation and planning remain stopped until this wording
correction and preparation record are independently reviewed and committed.
After commit, remove the four evidence files while retaining only the isolated
`TF_DATA_DIR` for the next approved H2 configuration step. Immediately before
any future apply, take a fresh requested-version-`3` IAM backup with current
etag and hash; this preparation snapshot must not be reused for rollback.

### H2 preparation evidence cleanup

The reviewed preparation and policy-version correction were committed in
`7168e6e` (`docs: record H2 reinitialization preflight`) before cleanup.
Cleanup then removed exactly the four inventoried evidence files:

- initialization log;
- validation JSON;
- serial-`4` state pull;
- non-apply IAM snapshot.

Post-cleanup verification found all four absent. The mode-`0700`
`/tmp/palette-bootstrap-h2-tfdata` runtime remains as the only
`/tmp/palette-bootstrap-h2-*` path so the next approved local configuration and
plan step can continue without using the unhealthy mounted provider cache. No
local state was created, the pre-existing mounted `.terraform` cache remains
untouched, and cleanup made no remote call or change.

H2 preparation and reinitialization are complete. The next explicit owner gate
is limited to H2 Terraform configuration and plan-only review; it does not
authorize IAM mutation. Any H2 apply or other remote IAM change requires a
separate later owner approval after a fresh backup, prepared rollback, and
reviewed plan.

## 2026-07-23 — H2 explicit state-bucket IAM plan reviewed

### Configuration and plan-only authorization

The owner explicitly authorized local H2 Terraform configuration and a locked,
plan-only review. This authorization excluded `apply`, IAM mutation, state
push, migration, service-account keys, and every other remote write.

Commit `727e103` (`infra: define explicit state bucket iam`) added only:

- an existing-service-account lookup for `palette-terraform`;
- authoritative state-bucket policy data with the exact operator as
  `roles/storage.admin` and `palette-terraform` as
  `roles/storage.objectAdmin`;
- one `google_storage_bucket_iam_policy` resource;
- one additive service-account IAM member granting only the exact operator
  `roles/iam.serviceAccountTokenCreator` on `palette-terraform`;
- the required `state_operator_email` variable and committed staging example.

No service-account key or unrelated resource was added. No additive bucket IAM
resource targets the state bucket.

### Configuration validation

Using the retained Linux `TF_DATA_DIR`, formatting and validation passed after
all configuration edits:

- `terraform fmt -check -diff`: passed;
- `terraform validate -json`: valid `true`, zero errors, zero warnings;
- `git diff --check`: passed.

The configuration was independently reviewed before commit with no blocker.

### Locked plan preconditions

The plan ran as active operator `nizar.main01@gmail.com` against configured
project `palette-503123`. Fresh read-only baselines confirmed:

- bootstrap state serial `4`, two instances, and zero taints;
- four current state-bucket convenience bindings, with neither target explicit
  principal present;
- zero current service-account IAM bindings on `palette-terraform`;
- exactly the same two `bootstrap/default.tfstate` generations sized `181` and
  `5824` bytes.

### Plan result

The approved command used no `-out`:

```text
TF_DATA_DIR=<retained mode-0700 Linux directory> terraform \
  -chdir=infra/terraform/bootstrap plan \
  -detailed-exitcode -lock=true -lock-timeout=0s -input=false -no-color \
  -var-file=terraform.tfvars.example
```

Detailed exit code `2` was expected because H2 is not yet applied. The exact
result was:

```text
Plan: 2 to add, 0 to change, 0 to destroy.
```

The only managed additions are:

1. `google_storage_bucket_iam_policy.terraform_state`, whose authoritative
   policy contains exactly:
   - `user:nizar.main01@gmail.com` → `roles/storage.admin`;
   - `serviceAccount:palette-terraform@palette-503123.iam.gserviceaccount.com`
     → `roles/storage.objectAdmin`;
2. `google_service_account_iam_member.operator_terraform_token_creator`, which
   grants only `user:nizar.main01@gmail.com`
   `roles/iam.serviceAccountTokenCreator` on the existing
   `palette-terraform` service account.

Terraform describes the authoritative policy as a resource creation because it
is not yet in Terraform state. On apply, its remote semantic effect would be to
replace the four convenience-role bindings with the two explicit bindings
above. The plan contains no bucket lifecycle, versioning, location,
public-access-prevention, API, project-service, service-account, key, state
object, update, replacement, or destroy action.

### Mandatory no-mutation postchecks

Postchecks ran for the plan's exit code `2` and confirmed:

- pre-plan and post-plan Terraform state are identical at serial `4`;
- bucket IAM policy and etag are identical before and after;
- `palette-terraform` service-account IAM is identical and still empty;
- the two state-object generation IDs and sizes are identical before and after;
- `bootstrap/default.tflock` is absent;
- no saved plan exists;
- no apply, state push, migration, `-force-copy`, IAM mutation, or other remote
  write ran.

Remote read activity consisted of pre-plan and post-plan state pulls,
bucket-IAM reads, service-account-IAM reads, state-generation listings, plan
refresh reads for the two managed bootstrap resources and existing service
account, and one absent-lock request. The GCS backend's plan lock was transient
and left no retained lock object.

An independent plan review passed with no blocker. It confirmed that the policy
retains direct operator administration, the service account remains keyless,
no apply ordering change is required, and no configuration correction is
needed before requesting the separate apply gate.

### Retained plan evidence and apply gate

The following eleven paths remain pending review and commit of this entry:

1. `/tmp/palette-bootstrap-h2-tfdata` — mode-`0700` Linux runtime;
2. `/tmp/palette-bootstrap-h2-config-validate.json`;
3. `/tmp/palette-bootstrap-h2-plan.log`;
4. `/tmp/palette-bootstrap-h2-plan-pre-state.tfstate`;
5. `/tmp/palette-bootstrap-h2-plan-post-state.tfstate`;
6. `/tmp/palette-bootstrap-h2-plan-pre-iam.json`;
7. `/tmp/palette-bootstrap-h2-plan-post-iam.json`;
8. `/tmp/palette-bootstrap-h2-plan-pre-sa-iam.json`;
9. `/tmp/palette-bootstrap-h2-plan-post-sa-iam.json`;
10. `/tmp/palette-bootstrap-h2-plan-pre-generations.txt`;
11. `/tmp/palette-bootstrap-h2-plan-post-generations.txt`.

All ten evidence files are mode `0600`. After this entry is independently
reviewed and committed, remove those ten files and retain only the mode-`0700`
`TF_DATA_DIR` for a separately approved apply procedure.

H2 apply and all IAM mutation remain unauthorized. Immediately before any
future apply, H2 requires a fresh requested-version-`3` IAM backup with actual
returned version, current etag, mode `0600`, SHA-256, and all bindings; a
prepared but unexecuted etag-aware rollback; exact operator and state access
rechecks; and a newly generated plan that still has only the reviewed effects.
A separate explicit owner approval is required after those gates.

### H2 plan evidence cleanup

The reviewed plan evidence was committed in `8053336`
(`docs: record H2 state bucket IAM plan`) before cleanup. Cleanup then removed
exactly the ten mode-`0600` evidence files listed above.

Post-cleanup verification found all ten absent. The mode-`0700`
`/tmp/palette-bootstrap-h2-tfdata` directory remains as the only
`/tmp/palette-bootstrap-h2-*` path for a separately approved apply-preflight
procedure. No local Terraform state or saved plan exists, the mounted
`.terraform` cache and unrelated working-tree files remain untouched, and
cleanup made no remote call or change.

H2 configuration and plan-only review are complete. IAM remains unchanged. The
next permissible gate is apply preflight only: take and verify the fresh IAM
backup, prepare rollback, recheck exact access/current etag, and regenerate the
plan. That preflight still does not authorize apply; a separate owner approval
is required after its evidence is reviewed.

## 2026-07-23 — H2 apply preflight completed

### Apply-preflight authorization

The owner authorized H2 apply preflight only. This authorization allowed fresh
read-only access/concurrency checks, a protected IAM backup, rollback
preparation, and plan generation. It did not authorize `terraform apply`, IAM
mutation, state push, migration, service-account keys, or restoration.

The scoped Terraform and runbook paths were clean before preflight. The
pre-existing untracked phase document remained untouched. The retained Linux
`TF_DATA_DIR` was mode `0700`, targeted the existing bootstrap GCS backend, and
contained backend/runtime metadata rather than local managed-resource state.

### Fresh protected IAM backup

The Storage JSON API was queried with `optionsRequestedPolicyVersion=3`. The
returned policy was saved unchanged to a mode-`0600` file with:

- actual policy version: `1`;
- etag: `CAE=`;
- conditional bindings: `0`;
- SHA-256:
  `947020993842b306a0638b2201e6d35a13c8870b1a516b21d2072f28e66c2af9`;
- exactly these four bindings:

| Role | Members |
| --- | --- |
| `roles/storage.legacyBucketOwner` | `projectEditor:palette-503123`, `projectOwner:palette-503123` |
| `roles/storage.legacyBucketReader` | `projectViewer:palette-503123` |
| `roles/storage.legacyObjectOwner` | `projectEditor:palette-503123`, `projectOwner:palette-503123` |
| `roles/storage.legacyObjectReader` | `projectViewer:palette-503123` |

The backup and its hash file remain protected and retained. No access token was
printed, logged, or retained.

### Prepared rollback

A mode-`0600` rollback procedure was prepared but not executed. It requires:

1. stopping bootstrap and staging Terraform;
2. fetching a fresh requested-version-`3` current policy and etag;
3. verifying the protected backup hash and stopping on any unproven concurrent
   etag change;
4. preserving the backup's actual version, complete bindings, conditions, and
   other fields while replacing only its stale etag with the fresh current
   etag;
5. independent candidate review;
6. separate explicit restoration approval before `setIamPolicy`;
7. full state, access, lock, key, bucket-security, and drift validation after
   any approved restoration.

It prohibits stale-etag retries, applying the backup unchanged, automatic
restoration, and `terraform state push`.

### Fresh access and state checks

Preflight ran as exact operator `nizar.main01@gmail.com` against project
`palette-503123`. Checks passed:

- configuration validation: valid, zero errors and zero warnings;
- operator: sole project Owner with bucket-IAM and both state-object read
  access;
- bootstrap state: serial `4`, two instances, zero taints;
- staging state: serial `10`, 33 instances, zero taints;
- state bucket: metageneration `1`, uniform access enabled, public-access
  prevention enforced, and versioning enabled;
- bootstrap state history: the same two generations sized `181` and `5824`
  bytes;
- `palette-terraform`: enabled, zero user-managed keys, zero service-account IAM
  bindings, and zero project roles.

### Initial non-saved apply-preflight plan

A first fresh locked plan again returned:

```text
Plan: 2 to add, 0 to change, 0 to destroy.
```

It contained only the reviewed authoritative bucket policy and operator Token
Creator additions. Pre/post bootstrap and staging state, bucket IAM and etag,
service-account IAM, bucket settings, and state generations were unchanged;
the transient plan lock disappeared; no saved plan or apply occurred.

Independent review found one high-severity procedural blocker: because this
plan used no `-out`, Terraform could not guarantee that a later bare apply
would execute the reviewed actions. Final approval could not safely bind to
that text output. Work remained in preflight and no apply was requested.

### Immutable reviewed saved plan

The blocker was corrected without changing configuration or regenerating the
prior text plan. A second fresh locked plan was written as a mode-`0600` binary
artifact and inspected with both `terraform show -no-color` and
`terraform show -json`.

The saved plan is bound to:

| Field | Value |
| --- | --- |
| Path | `/tmp/palette-bootstrap-h2-reviewed.tfplan` |
| SHA-256 | `9c6dedb334c984115d9551978f1de448b3ed772c270d9ef7be3d8c8155ea1509` |
| Source HEAD | `5c02702b617d0956d5e21ac0b1809a8d725cb60d` |
| H2 configuration commit | `727e103192536b9ce0c6a52fab01602eeeb28a1f` |
| Active account | `nizar.main01@gmail.com` |
| Project | `palette-503123` |
| Plan | `2 to add, 0 to change, 0 to destroy` |
| Approval status | not approved |

The only managed changes are creates for:

- `google_storage_bucket_iam_policy.terraform_state`;
- `google_service_account_iam_member.operator_terraform_token_creator`.

The policy contains only the exact reviewed operator/storage-admin and
Terraform-service-account/object-admin bindings. Because it has no conditions,
its `policy_data` correctly omits a `version` field, which carries actual
version-`1` semantics. The Token Creator grant targets only the exact operator
on the existing `palette-terraform` account. There is no update, replacement,
destroy, key, bucket lifecycle, API, service-account, or unrelated action.

The first local saved-plan verifier incorrectly required policy-data version
`3` and stopped after the binary plan and show outputs were created. This was a
local assertion mismatch, not a Terraform or remote divergence: no-condition
policy data correctly omits the version. The assertion was corrected, the
existing saved plan was not regenerated, and mandatory postchecks then passed.

### Saved-plan concurrency and no-mutation postchecks

Immediately before and after saved-plan generation:

- the fresh current IAM policy, actual version, etag `CAE=`, and bindings exactly
  matched the protected backup;
- bootstrap and staging states remained serial `4` and `10` with matching
  lineages and contents;
- state generations and sizes remained unchanged;
- bucket generation/security settings remained unchanged;
- service-account IAM remained empty;
- `bootstrap/default.tflock` was absent afterward;
- the saved-plan hash and mode were verified;
- no apply ran.

An independent second review passed with no blocker and confirmed that final
approval can be bound only to this immutable saved plan after immediate
execution checks.

### Remote activity accounting

Across apply preflight and saved-plan correction, read-only evidence used four
requested-version-`3` bucket-IAM GETs, four bootstrap state pulls, four staging
state content reads, four state-generation listings, four bucket descriptions,
four service-account-IAM reads, one project-IAM read, one service-account
description, and one user-managed-key listing. Two plan invocations refreshed
only the reviewed resources and each used a transient GCS lock that was removed
and verified absent. Provider schema/show and hash operations were local.

There was no durable remote mutation. No apply, policy write, state push,
migration, `-force-copy`, key creation, or rollback execution occurred.

### Retained apply package and final execution gate

Thirty-five H2 paths are retained: thirty-four mode-`0600` files and the
mode-`0700` `TF_DATA_DIR`. They comprise the protected IAM backup/hash,
rollback procedure, both plan-preflight evidence sets, immutable saved plan and
hash, text/JSON shows, source-binding metadata, state/IAM/bucket/generation
pre/post evidence, and the isolated runtime. Nothing is committed from `/tmp`.

Final owner approval must bind to the exact saved-plan path, hash, source HEAD,
and H2 configuration commit above. Immediately before execution, one atomic
fail-closed sequence must verify:

1. saved plan mode `0600` and exact SHA-256;
2. plan-source commit `5c02702b617d0956d5e21ac0b1809a8d725cb60d`
   remains an ancestor of current HEAD; tracked bootstrap configuration and
   provider lock content remain byte-identical to that source tree and H2
   configuration commit `727e103192536b9ce0c6a52fab01602eeeb28a1f`; and no
   bootstrap worktree change exists. Later documentation-only commits are
   allowed;
3. active account `nizar.main01@gmail.com` and project `palette-503123`;
4. protected backup mode/hash;
5. fresh requested-version-`3` IAM policy semantically identical to the complete
   backup, including actual version `1`, etag `CAE=`, and all four bindings;
6. bootstrap/staging serials `4`/`10`, recorded lineages, state generations and
   sizes, bucket generation/security settings, and empty service-account IAM
   unchanged;
7. no bootstrap lock object;
8. apply only `/tmp/palette-bootstrap-h2-reviewed.tfplan` using the retained
   `TF_DATA_DIR`, with no planning or replanning.

Any mismatch invalidates approval and requires plan regeneration and review.
The saved plan remains unapproved and must not be applied until the owner gives
separate explicit approval against this exact gate.

## 2026-07-23 — H2 explicit state-bucket access applied and validated

### Final approval and atomic execution gate

The owner explicitly approved applying only the immutable saved plan documented
above. Immediately before execution, one fail-closed sequence reverified:

- saved-plan mode `0600` and SHA-256
  `9c6dedb334c984115d9551978f1de448b3ed772c270d9ef7be3d8c8155ea1509`;
- protected IAM backup mode `0600` and SHA-256
  `947020993842b306a0638b2201e6d35a13c8870b1a516b21d2072f28e66c2af9`;
- plan-source ancestry, byte-identical bootstrap configuration/provider lock,
  and a clean bootstrap worktree;
- exact operator `nizar.main01@gmail.com` and project `palette-503123`;
- current IAM policy actual version `1`, etag `CAE=`, and all four bindings
  exactly matching the protected backup;
- bootstrap/staging serials `4`/`10`, lineages, state generations, bucket
  settings, and empty `palette-terraform` service-account IAM;
- absence of `bootstrap/default.tflock`.

Every gate passed. Terraform then applied only
`/tmp/palette-bootstrap-h2-reviewed.tfplan` through the retained Linux
`TF_DATA_DIR`, with no planning or replanning.

### Apply result

The saved-plan apply returned exit code `0`:

```text
Apply complete! Resources: 2 added, 0 changed, 0 destroyed.
```

Terraform created only:

1. `google_storage_bucket_iam_policy.terraform_state`;
2. `google_service_account_iam_member.operator_terraform_token_creator`.

Remote state-bucket IAM now contains exactly:

| Role | Member |
| --- | --- |
| `roles/storage.admin` | `user:nizar.main01@gmail.com` |
| `roles/storage.objectAdmin` | `serviceAccount:palette-terraform@palette-503123.iam.gserviceaccount.com` |

All four legacy project convenience bindings were removed. The new bucket
policy has actual version `1`, no conditions or public principals, and etag
`CAI=`.

The `palette-terraform` service-account policy now contains exactly one binding:

- `user:nizar.main01@gmail.com` →
  `roles/iam.serviceAccountTokenCreator`.

No service-account key, API, bucket, workload, image, secret, user data, or
unrelated IAM resource was created or changed. The prepared rollback was not
executed because the intended policy was applied successfully.

### Immediate reconciliation and assertion correction

Bootstrap state advanced from serial `4` to serial `5`, retained its lineage,
and has zero taints. It now contains four managed instances plus two data-source
instances:

Managed:

- `google_project_service.storage`;
- `google_storage_bucket.terraform_state`;
- `google_storage_bucket_iam_policy.terraform_state`;
- `google_service_account_iam_member.operator_terraform_token_creator`.

Data:

- `data.google_iam_policy.terraform_state`;
- `data.google_service_account.terraform`.

The first local postcheck incorrectly required four total state instances and
an unchanged bucket metageneration. It stopped after the successful apply. This
was a local assertion mismatch, not a remote-plan divergence: Terraform records
the two data sources in state, and changing the bucket IAM policy correctly
advanced bucket metageneration from `1` to `2`. The assertion was corrected
without another apply or rollback.

Corrected reconciliation confirmed:

- bootstrap serial `5`, four managed plus two data instances, zero taints;
- staging state byte-identical at serial `10`, 33 instances, zero taints;
- bootstrap state history increased from two to three generations;
- bucket generation, location, lifecycle, soft-delete policy, uniform access,
  public-access prevention, and versioning remained unchanged;
- only bucket metageneration changed, from `1` to `2`, as expected for IAM;
- exact bucket and service-account IAM policies above;
- no retained bootstrap lock.

### Terraform and identity validation

A fresh locked operator plan returned exit code `0`:

```text
No changes. Your infrastructure matches the configuration.
```

The lock was acquired and released, and no saved plan was created.

Positive `palette-terraform` impersonation checks passed:

- operator Token Creator grant issued an impersonated access token;
- exact bootstrap and staging state objects could be listed and read;
- the read states were serial `5`/`10` with six/33 total instances and zero
  taints;
- an isolated non-sensitive object was created, listed, read byte-for-byte, and
  deleted;
- an isolated Terraform GCS backend initialized through
  `impersonate_service_account` and completed a locked no-change plan;
- the isolated backend created real lock-history versions, released its current
  lock, and all isolated state/lock object versions were deleted afterward.

A final all-versions cleanup found one archived version of the isolated object
CRUD test. `palette-terraform` deleted that version, after which the entire
`h2-validation` prefix was empty.

`palette-terraform` remains enabled and has zero user-managed keys.

### Default Compute denial evidence

A direct negative state read could not be claimed: the operator does not have
Token Creator on the default Compute service account, so impersonation stopped
at `iam.serviceAccounts.getAccessToken` before Storage authorization. No grant
was added for this test.

A Policy Troubleshooter check was also unavailable because
`policytroubleshooter.googleapis.com` is disabled. The API was not enabled.

Fail-closed static IAM proof instead confirmed:

- the project has no organization or folder ancestor;
- the default Compute account has exactly project role `roles/editor`;
- the current Editor role excludes `storage.objects.get` and
  `storage.objects.list`;
- state-bucket IAM contains neither the default account nor any project
  convenience principal;
- uniform bucket-level access is enabled, so object ACLs cannot grant access.

Therefore, the complete applicable IAM evidence contains no allow path for the
default Compute service account to read Terraform state. Independent review
accepted this as static denial proof while accurately preserving the direct-
test limitation.

### Final checkpoint

Final read-only snapshots confirmed:

- bootstrap state serial `5`, six total state instances, zero taints;
- staging state serial `10`, 33 instances, zero taints;
- exact two-binding state-bucket IAM and exact one-binding service-account IAM;
- `palette-terraform` has zero user-managed keys;
- bucket metageneration `2`, with location and security/lifecycle settings
  unchanged;
- three bootstrap state-object generations;
- no main Terraform lock;
- no object or retained version under `h2-validation`;
- no Terraform drift.

Independent review passed with no blocker and concluded that H2 succeeded; the
prepared rollback would undo the intended hardening and must not run.

### Remote action accounting

The approved durable writes were exactly the authoritative state-bucket policy,
the operator Token Creator membership, and Terraform's resulting bootstrap
state update/version. Apply and the post-apply no-drift plan used transient GCS
state locks, each released and verified absent.

Validation also intentionally performed and cleaned up:

- one impersonated object create/read/list/delete test, including its archived
  version;
- one isolated impersonated Terraform backend state object and two lock-history
  versions, all deleted;
- impersonated reads of both real state objects.

Read-only actions covered pre/post/final state pulls, requested-version-`3` IAM
reads, bucket/service-account/project IAM reads, bucket descriptions, state
version listings, user-key listings, project ancestry, the Editor role, and
lock/object absence checks. The failed default-account token request and
unavailable Troubleshooter request made no change. No API was enabled, no
rollback ran, and no state push, migration, `-force-copy`, service-account key,
or unrelated apply occurred.

### Explicit evidence cleanup gate

A mode-`0600` cleanup inventory lists the exact 85 H2 paths created before the
inventory itself. Its SHA-256 is
`779803dfa981c4eee2ad0d9d36a6d4fe7c556f90b10b12f40cb46a8073217f38`.
Including the inventory file, cleanup is authorized for exactly 86 paths after
this apply/validation entry is independently reviewed and committed.

The inventory includes the protected pre-apply policy backup/hash, rollback
procedure, immutable saved plan/hash/show/metadata, all preflight/execution/
post-apply/final state and IAM evidence, impersonation and denial evidence,
isolated lock-test roots/runtime/logs, and the primary Linux `TF_DATA_DIR`.
No `/tmp` evidence is committed.

Do not remove any evidence before this entry is committed. After commit, cleanup
must validate the inventory hash and prefix, remove only the 85 listed paths,
then remove the inventory file itself. It must not touch the pre-existing
mounted `.terraform` caches or unrelated working-tree files. Cleanup completion
must be verified and documented separately.

### H2 evidence cleanup and closure

The independently reviewed apply/validation entry was committed in `2056c81`
(`docs: record state bucket hardening`) before cleanup.

Cleanup reverified the mode-`0600` inventory SHA-256
`779803dfa981c4eee2ad0d9d36a6d4fe7c556f90b10b12f40cb46a8073217f38`,
85 unique entries, exact `/tmp/palette-bootstrap-h2-` prefixes, existence of
every listed path, absence of symlinks, and exact equality between the current
H2 artifact set and the inventory plus the inventory file.

Cleanup then removed only the 85 inventoried paths and finally the inventory
file, for exactly 86 cleanup targets. Post-cleanup verification found:

- zero `/tmp/palette-bootstrap-h2-*` paths;
- no local bootstrap state or backup;
- no saved Terraform plan;
- committed backend and H2 IAM configuration present;
- pre-existing mounted bootstrap/staging `.terraform` caches untouched;
- unrelated working-tree files untouched and unstaged.

Cleanup made no GCP API call, Terraform backend call, or remote change.

H2 is complete. State-bucket IAM is explicit, operator and Terraform automation
access are validated, the Terraform identity is keyless, both states remain
readable, locking and isolated object permissions passed, the bootstrap root is
drift-free, and all temporary evidence is removed. The default Compute denial
remains a documented point-in-time static IAM proof rather than a direct
Storage denial response. H3 or any other hardening step requires a separate
owner gate.

## 2026-07-24 — H3 application-bucket IAM configuration and preflight

### Authorization and stop boundary

The owner approved H3 preflight and local configuration work only. This approval
did not authorize a remote IAM write, Terraform state mutation, `terraform
state rm`, `terraform plan`, `terraform apply`, rollback, restoration, or
evidence cleanup.

The scoped staging Terraform and operations-log paths were clean before H3
work. The wider worktree contained unrelated application and planning changes;
those paths remained untouched and unstaged.

### Atomic configuration transition

Commit `9f5639b` (`infra: define application bucket policies`) atomically:

- removed all four additive `google_storage_bucket_iam_member` declarations;
- added one complete `google_iam_policy` data source and one authoritative
  `google_storage_bucket_iam_policy` resource for each application bucket;
- added a required application-bucket operator variable with exact-value
  validation for `nizar.main01@gmail.com`;
- removed the pre-existing unused `budget_amount_usd` declaration, example
  value, and stale comments after an automated Terraform diagnostic required
  that cleanup.

The configured target policies are exactly:

- Input bucket:
  - `user:nizar.main01@gmail.com` → `roles/storage.admin`;
  - `serviceAccount:palette-api-runtime@palette-503123.iam.gserviceaccount.com`
    → `roles/storage.objectAdmin`;
  - `serviceAccount:palette-worker-runtime@palette-503123.iam.gserviceaccount.com`
    → `roles/storage.objectViewer`.
- Artifacts bucket:
  - `user:nizar.main01@gmail.com` → `roles/storage.admin`;
  - `serviceAccount:palette-worker-runtime@palette-503123.iam.gserviceaccount.com`
    → `roles/storage.objectAdmin`;
  - `serviceAccount:palette-api-runtime@palette-503123.iam.gserviceaccount.com`
    → `roles/storage.objectViewer`.

No additive application-bucket IAM resource, convenience principal, public or
browser principal, unrelated service account, or additional bucket-IAM binding
is encoded. The transition was independently reviewed twice; the first review's
operator-value finding was fixed, and the final review passed with no blocker.

Using an isolated mode-`0700` Linux `TF_DATA_DIR`, validation passed:

- `terraform fmt -check -diff`;
- `terraform validate -json`: valid, zero errors, zero warnings;
- `git diff --check`;
- static inspection: zero additive bucket-IAM resources and exactly two
  authoritative application-bucket policy resources.

No Terraform plan was generated. In particular, no two-create plan is claimed
before the separately approved state removal.

### Read-only state baseline and protected backup

Preflight ran as active operator `nizar.main01@gmail.com` against configured
project `palette-503123`. Backend initialization used `-reconfigure`,
`-lockfile=readonly`, and `-input=false` with the isolated Linux runtime. It did
not migrate, force-copy, plan, apply, or change state.

The protected mode-`0600` staging-state backup has:

- serial `10`;
- lineage `b0b96d01-e02f-c3b9-26dd-ac10aa943189`;
- `33` total instances and zero taints;
- SHA-256
  `09ab192c8afb7e93cd329eedf82f19ad83104d3e213f44914cc57c64e88184e9`.

It contains exactly the four obsolete addresses named by the H3 plan and no
authoritative application-bucket policy resource:

```text
google_storage_bucket_iam_member.api_input_object_admin
google_storage_bucket_iam_member.api_artifacts_object_viewer
google_storage_bucket_iam_member.worker_input_object_viewer
google_storage_bucket_iam_member.worker_artifacts_object_admin
```

A final state pull was byte-identical to the protected backup. The staging lock
object was absent before and after postchecks.

### Protected IAM backups and bucket baselines

Both complete IAM policies were fetched through the Storage JSON API with
`optionsRequestedPolicyVersion=3` and saved unchanged in mode-`0600` files.
Each correctly returned actual version `1`, etag `CAM=`, six bindings, zero
conditions, and zero public principals.

Protected IAM backup hashes:

- Input:
  `a15bc2a0f082eb8aafb0940a57e37a599856ce1310efef7ade87d0a59987b674`;
- artifacts:
  `bc65160ea655d35b3336c33ee7a00e966b9da434502afdb795949f0dff87698e`.

Each current policy contains the intended API/worker runtime binding plus the
four legacy project convenience bindings inherited from the pre-H3 policy.
Fresh requested-version-`3` postchecks were exactly JSON-identical, including
etags, to the protected backups.

Bucket baselines remain:

- input: location `US-CENTRAL1`, generation `1784776990806317780`,
  metageneration `3`, uniform access enabled, public access prevention enforced,
  versioning disabled, lifecycle delete age one day, and soft-delete retention
  `604800` seconds;
- artifacts: location `US-CENTRAL1`, generation `1784776990843060070`,
  metageneration `3`, uniform access enabled, public access prevention enforced,
  versioning enabled, lifecycle delete age seven days, and soft-delete retention
  `604800` seconds.

Fresh postcheck descriptions for both buckets were exactly JSON-identical to
these protected baseline descriptions.

### Prepared restoration and retained evidence

A mode-`0600`, unexecuted restoration procedure was prepared with SHA-256
`58c34e7f588ee24a87b1dc4f666e837d252af7af50ccba7d974bdc5239eb399e`.
It requires a fresh requested-version-`3` policy and current etag, backup hash
verification, fail-closed concurrent-change checks, an independently reviewed
candidate that replaces only the stale backup etag, and separate explicit owner
approval before any `setIamPolicy` request. It prohibits stale-etag retries,
automatic restoration, and `terraform state push`.

The current mode-`0600` evidence inventory has SHA-256
`7978ac4b3fb72cc02ab1f29818393d00f714c1d04d595d8482b82b4eefcd2bbc`
and records `43` paths beneath the exact `/tmp/palette-staging-h3-` prefix:
`36` files, `7` directories, and zero symlinks. The inventory file itself is the
forty-fourth retained path. It includes the isolated runtime, validation result,
state/IAM backups and hashes, bucket baselines and postchecks, initial and final
read-only evidence, lock-absence checks, and restoration procedure.

No evidence is authorized for cleanup. The protected state and IAM backups must
remain through any later apply and until all H3 validation passes. The inventory
must be regenerated and reverified before any eventual cleanup.

### No-mutation result and next permission gate

Configuration and read-only preflight caused no durable remote mutation. State
remained byte-identical at serial `10`; both IAM policies and etags remained
identical; bucket baselines remained unchanged; and no lock remained. No plan,
apply, state removal, IAM write, restoration, API enablement, key creation, or
unrelated cloud action ran.

H3 is now stopped. The next required owner approval is for one exact locked
`terraform state rm` command removing only the four addresses listed above.
That approval does not authorize IAM mutation or apply. After state removal,
state serial transition and unchanged remote IAM must be recorded before an
immutable saved plan is generated. Only a reviewed plan with exactly two
creates, zero updates, and zero destroys may advance to a separate apply gate.

## 2026-07-24 — H3 application-bucket IAM state transition

### Approved mutation boundary

The owner approved the exact locked state removal and required that access not
be lost. The approval permitted removing only the four obsolete additive
application-bucket IAM addresses from Terraform state, followed by read-only
postchecks and immutable saved-plan generation. It did not authorize a remote
IAM write, `terraform apply`, rollback, restoration, API enablement,
service-account change, or evidence cleanup.

The exact command used the retained isolated Linux `TF_DATA_DIR`, locking with a
zero-second timeout, and these four addresses in one invocation:

```text
google_storage_bucket_iam_member.api_input_object_admin
google_storage_bucket_iam_member.api_artifacts_object_viewer
google_storage_bucket_iam_member.worker_input_object_viewer
google_storage_bucket_iam_member.worker_artifacts_object_admin
```

### Atomic prechecks

The fail-closed execution gate ran as exact operator
`nizar.main01@gmail.com` against project `palette-503123` and source HEAD
`ecec86d78caab1cb377da00eeac62c8c5e08545a`. Checks confirmed:

- configuration commit `9f5639b` is an ancestor of HEAD and the tracked staging
  Terraform files are byte-identical to that commit;
- the staging Terraform worktree and index are clean;
- validation is valid with zero errors and zero warnings;
- all protected state/IAM backups and the restoration procedure remain
  mode `0600` with their recorded hashes;
- staging state is byte-identical to the protected backup at serial `10`, the
  recorded lineage, `33` instances, and zero taints;
- state contains exactly the four approved addresses and no authoritative
  application-bucket policy address;
- both requested-version-`3` IAM reads exactly match the protected backups at
  actual version `1`, etag `CAM=`, six bindings, and zero conditions;
- both bucket descriptions exactly match the protected baselines;
- operator IAM reads and object-list access succeed on both application
  buckets;
- no live staging lock object exists.

Any mismatch would have stopped before mutation. Every gate passed.

### Locked state removal result

Terraform acquired the staging backend lock, removed exactly the four approved
resource instances, wrote the resulting state, and released the lock. It
reported:

```text
Successfully removed 4 resource instance(s).
```

The execution log is mode `0600` with SHA-256
`43ff4a79f2f87bfd331ee85c171dd8b5a6cd7d407265b78d9cb73c17108a0145`.

Staging state transitioned exactly:

- serial `10` → `11`;
- lineage unchanged;
- total instances `33` → `29`;
- zero taints before and after;
- all four obsolete additive IAM addresses absent afterward;
- both authoritative application-bucket policies still absent, as expected
  before apply.

The protected serial-`10` backup remains retained with SHA-256
`09ab192c8afb7e93cd329eedf82f19ad83104d3e213f44914cc57c64e88184e9`.
The serial-`11` post-state has SHA-256
`045cbd174fdbf80c58b8118402480043f7a6389eab2e7296e80465e479adf1ec`.
The state object now has eleven retained generations, exactly one live. The
lock object has zero live generations; its archived lock history was observed
read-only and not modified.

### Access-preservation and no-IAM-mutation proof

Fresh requested-version-`3` postchecks are byte-identical to their prechecks
and protected backups:

- input IAM remains actual version `1`, etag `CAM=`, SHA-256
  `a15bc2a0f082eb8aafb0940a57e37a599856ce1310efef7ade87d0a59987b674`;
- artifact IAM remains actual version `1`, etag `CAM=`, SHA-256
  `bc65160ea655d35b3336c33ee7a00e966b9da434502afdb795949f0dff87698e`.

Both bucket post-descriptions are exactly identical to their pre-descriptions.
The operator can still read both IAM policies, describe both buckets, list
objects in both buckets, and read the remote staging state. The state removal
itself also proved authorized state-bucket lock/write access. No live lock
remains.

Therefore, the state transition did not change either application-bucket IAM
policy and did not lock out the operator or either existing runtime principal.
No IAM API write, plan, apply, restoration, or unrelated cloud mutation ran.

### Retained evidence and plan-only next step

The regenerated mode-`0600` checkpoint inventory has SHA-256
`4b921b3b5d885f8de21b1579f1168cb902dd8814139269df07089904be0913b9`
and records `91` paths: `84` files, `7` directories, and zero symlinks. The
inventory itself is the ninety-second retained path. Protected state/IAM
backups, restoration material, the isolated runtime, exact execution evidence,
pre/post access checks, and state/lock generation listings remain retained.
Nothing is authorized for cleanup.

The next permissible work is plan-only: after this state-transition record is
independently reviewed and committed, generate one immutable saved plan. It
must contain exactly two creates, zero updates, and zero destroys, preserve
operator administration in both complete policies, and contain no bucket,
lifecycle, location, versioning, soft-delete, CORS, public-access, API,
service-account, or unrelated action. Applying that plan requires a separate
explicit owner approval.

## 2026-07-24 — H3 immutable application-bucket IAM plan reviewed

### Plan-only authorization and source binding

The approved state-transition gate permitted read-only postchecks and generation
of one immutable saved plan after the reviewed transition record was committed.
It did not authorize `terraform apply`, a remote IAM write, another state
mutation, rollback, restoration, or evidence cleanup.

The first local plan attempt was reported as using an incorrect expected full
SHA for the newly created documentation commit. Its retained log shows that it
stopped immediately after reporting the actual HEAD and before validation,
state pull, refresh, lock acquisition, or plan generation, which is consistent
with the reported fail-closed source-equality mismatch. The log does not record
the incorrect expected value itself. No saved plan existed. The mode-`0600`
stopped-attempt log was retained with SHA-256
`ef3fdb96372438bdcd2f5711db5f98517a00a2e43dbaa23b3abeaec904f4ddbf`.

The successful plan is bound to:

- path: `/tmp/palette-staging-h3-reviewed.tfplan`;
- SHA-256:
  `2f38c202b00bc3fe0830868f9959283e2955356c8313fe22bf39d834da908455`;
- mode `0600` and size `18236` bytes;
- source HEAD: `41deb0b310f8e38d601956c56c4befd2c48c7d3b`;
- configuration commit: `9f5639bac814a90c2ecca81dcb8745103b2c48b7`;
- active account: `nizar.main01@gmail.com`;
- project: `palette-503123`;
- pre-plan state: serial `11`, SHA-256
  `045cbd174fdbf80c58b8118402480043f7a6389eab2e7296e80465e479adf1ec`;
- approval status: not approved.

The configuration commit is an ancestor of the source HEAD. Tracked staging
Terraform files were clean and byte-identical to that configuration commit.

### Fail-closed plan prechecks

Fresh prechecks confirmed:

- exact operator, project, source HEAD, configuration, and provider lock;
- valid Terraform configuration with zero errors and zero warnings;
- staging state serial `11`, recorded lineage, `29` instances, and zero taints;
- no additive or authoritative application-bucket IAM resource in state;
- protected serial-`10` state backup, both IAM backups, and restoration
  procedure still mode `0600` with their recorded hashes;
- both remote IAM policies exactly match the protected backups at actual version
  `1`, etag `CAM=`, six bindings, and zero conditions;
- both bucket descriptions exactly match protected baselines;
- operator IAM reads and object-list access succeed on both buckets;
- no live staging lock exists.

Any mismatch would have stopped before plan generation. Every gate passed.

### Immutable saved-plan result

A single locked `terraform plan` wrote the binary artifact above. Detailed exit
code `2` was expected. Both retained text and JSON representations, plus a
direct independent `terraform show` of the saved binary, confirm:

```text
Plan: 2 to add, 0 to change, 0 to destroy.
```

The only managed non-no-op actions are creates for:

1. `google_storage_bucket_iam_policy.input`;
2. `google_storage_bucket_iam_policy.artifacts`.

The input policy contains exactly:

- `user:nizar.main01@gmail.com` → `roles/storage.admin`;
- API runtime → `roles/storage.objectAdmin`;
- worker runtime → `roles/storage.objectViewer`.

The artifact policy contains exactly:

- `user:nizar.main01@gmail.com` → `roles/storage.admin`;
- worker runtime → `roles/storage.objectAdmin`;
- API runtime → `roles/storage.objectViewer`.

There is no public, browser, convenience, legacy, unrelated, or additional
planned principal. JSON review found the two creates, `29` no-op managed
resources, and zero update, destroy, replacement, or other action. Bucket
location, lifecycle, versioning, soft delete, CORS, public-access prevention,
APIs, service accounts, secrets, and all unrelated resources are no-op.

The plan JSON reports three informational refresh-drift entries for bucket
`updated` timestamps and Secret Manager null-to-empty normalization. Their
corresponding resource changes are no-op; the saved plan will not perform those
updates.

### No-mutation and access-preservation postchecks

Pre-plan and post-plan state are byte-identical at serial `11` with SHA-256
`045cbd174fdbf80c58b8118402480043f7a6389eab2e7296e80465e479adf1ec`.
Fresh pre/post IAM policies, etags, bucket descriptions, and object-list results
are byte-identical. The operator retained IAM-read and object-list access on
both buckets. The transient plan lock was released and no live lock remains.

The plan operation caused no durable remote mutation. No apply, IAM write,
state write, restoration, API enablement, key creation, or unrelated cloud
mutation ran.

### Independent review, retained evidence, and apply gate

Independent review passed with no blocker. It reproduced the retained text and
JSON directly from the saved binary, verified the plan hash and source binding,
confirmed the exact complete operator/API/worker policies, and found no action
that could alter bucket configuration or an unrelated resource.

The regenerated mode-`0600` evidence inventory has SHA-256
`e70a49c7c806708a6cf178007a2f39499a556d323d7c071333576eb70aa79b19`
and records `147` paths: `140` files, `7` directories, and zero symlinks. The
inventory itself is the one-hundred-forty-eighth retained path. All protected
backups, restoration material, state-transition evidence, immutable plan and
hash, show outputs, source metadata, plan pre/post checks, stopped-attempt log,
and isolated runtime remain retained. Nothing is authorized for cleanup.

H3 is stopped at the final apply gate. Any approval must bind to the exact plan
path, hash, source HEAD, configuration commit, account, project, and serial
above. Immediately before execution, one fail-closed sequence must verify:

- the saved-plan mode and hash;
- plan-source HEAD `41deb0b310f8e38d601956c56c4befd2c48c7d3b` remains an ancestor
  of current HEAD;
- every descendant commit after the plan source is documentation-only;
- tracked staging Terraform configuration and provider lock content remain
  byte-identical to configuration commit `9f5639b`, with a clean staging
  worktree and index;
- protected-backup hashes, fresh requested-version-`3` IAM/etag equality,
  operator access, state serial/lineage/taints, bucket settings, and lock
  absence all match the recorded gate.

Any mismatch invalidates approval. Only the immutable saved plan may be applied,
with no replanning. Apply remains unauthorized until separate explicit owner
approval.

## 2026-07-24 — H3 application-bucket IAM applied and validated

### Final approval and fail-closed execution gate

The owner approved applying only the immutable plan documented above. This did
not authorize replanning, rollback, restoration, unrelated IAM or state work,
API enablement, service-account changes, or evidence cleanup.

Immediately before execution, one fail-closed sequence verified:

- active operator `nizar.main01@gmail.com` and project `palette-503123`;
- saved plan path, regular-file mode `0600`, and SHA-256
  `2f38c202b00bc3fe0830868f9959283e2955356c8313fe22bf39d834da908455`;
- plan-source commit `41deb0b310f8e38d601956c56c4befd2c48c7d3b` remains an ancestor
  of then-current HEAD `0f5caac67b35176c4e854db8733c827e55b74e5c`;
- the only descendant change is the application-bucket plan record in this
  operations log;
- staging Terraform configuration and provider lock are byte-identical to
  configuration commit `9f5639b`, with a clean staging worktree and index;
- validation is valid with zero errors and zero warnings;
- staging state is serial `11`, the recorded lineage, `29` instances, zero
  taints, and byte-identical to the plan-bound state;
- protected serial-`10` state backup, both IAM backups, and restoration
  procedure remain mode `0600` with their recorded hashes;
- both current IAM policies exactly match the protected pre-H3 backups at
  version `1`, etag `CAM=`, six bindings, and zero conditions;
- both bucket descriptions exactly match protected baselines;
- the operator can read both policies, list both buckets' objects, and has all
  seven tested bucket/IAM/object administration permissions;
- no live staging lock exists;
- saved-plan JSON still contains only the two reviewed policy creates.

Any mismatch would have stopped before apply. Every gate passed.

### Immutable saved-plan apply result

Terraform applied only `/tmp/palette-staging-h3-reviewed.tfplan` through the
retained isolated Linux `TF_DATA_DIR`, with no planning or replanning. It
reported:

```text
Apply complete! Resources: 2 added, 0 changed, 0 destroyed.
```

The only created managed resources are:

1. `google_storage_bucket_iam_policy.input`;
2. `google_storage_bucket_iam_policy.artifacts`.

The mode-`0600` apply output has SHA-256
`97788a41cdec978806423fd2db92203ca79606e01af602cd43a9edf24c4dab5f`.
The mode-`0600` execution-gate transcript has SHA-256
`af0c84caecbe95100e79b37e85442b61571f3d1dbfdc4ba07e9cfe6d9e0508c5`.
The prepared restoration was not executed because the reviewed policies applied
successfully and access remained available.

### Final policies and operator access

Input-bucket IAM now contains exactly:

- `user:nizar.main01@gmail.com` → `roles/storage.admin`;
- API runtime → `roles/storage.objectAdmin`;
- worker runtime → `roles/storage.objectViewer`.

Artifact-bucket IAM now contains exactly:

- `user:nizar.main01@gmail.com` → `roles/storage.admin`;
- worker runtime → `roles/storage.objectAdmin`;
- API runtime → `roles/storage.objectViewer`.

Both policies have actual version `1`, etag `CAQ=`, three bindings, zero
conditions, and no public, browser, legacy convenience, default Compute, Cloud
Services, or unrelated principal.

The operator was not locked out. Fresh authenticated tests passed on both
buckets for:

- bucket description and IAM-policy read;
- `storage.buckets.get`;
- `storage.buckets.getIamPolicy`;
- `storage.buckets.setIamPolicy`;
- `storage.objects.list`;
- `storage.objects.get`;
- `storage.objects.create`;
- `storage.objects.delete`.

Object-list requests also succeeded. Permission testing did not create or delete
objects, so no validation object or soft-deleted object was left behind.

### State, bucket, drift, and lock validation

Staging state advanced exactly:

- serial `11` → `12`;
- lineage unchanged;
- `31` managed instances plus two data-source instances, `33` total;
- zero taints;
- exactly two authoritative application-bucket policies present;
- zero obsolete additive application-bucket IAM members.

Apply, validation-pre/post, and final state snapshots are byte-identical at
serial `12`, with SHA-256
`bdcf32ea36350b113af4d723b0286de7bade7e173c59bbdffbd94fec6985b726`.
The staging state object has twelve retained generations and exactly one live
generation.

Each bucket's IAM change advanced metageneration from `3` to `4`, as expected.
Generation, region, labels, lifecycle, versioning, soft-delete policy, uniform
access, public-access prevention, and absent CORS remain unchanged.

A fresh locked no-drift plan returned detailed exit code `0` and reported:

```text
No changes. Your infrastructure matches the configuration.
```

Pre-plan and post-plan state were byte-identical. The lock object has zero live
generations; all 23 observed generations are archived/deleted history. No live
lock remains.

### Runtime, cross-role, default, and public validation

The API and worker service accounts remain keyless and have empty
service-account IAM policies. Direct impersonated Storage checks were not
available because the operator has no Token Creator grant on those runtime
identities. Impersonation stopped before Storage authorization; no permission,
key, or API was added for testing.

Fail-closed static proof instead confirms:

- `roles/storage.objectAdmin` contains object get, list, create, and delete;
- `roles/storage.objectViewer` contains get and list but excludes create and
  delete;
- each runtime principal appears only in its exact intended binding on each
  complete bucket policy;
- therefore the intended positive and cross-role boundaries are encoded by the
  authoritative policies and current predefined-role definitions.

The default Compute service account remains only a project Editor. The current
Editor role contains none of the seven tested bucket/IAM/object permissions, and
the account is absent from both authoritative bucket policies. Uniform access
is enabled, so object ACLs cannot add an alternate path.

Unauthenticated IAM and object-list requests returned `401` for both buckets.
Neither `allUsers` nor `allAuthenticatedUsers` appears in either policy, and
public-access prevention remains enforced.

### Independent review and retained evidence

Independent review passed with no blocker. It verified the immutable-plan hash,
source/config binding, exact apply result, state transition, final policies,
operator access, bucket invariants, no-drift result, lock absence, protected
backups, restoration procedure, and complete evidence inventory.

The review accurately retains two limitations:

- runtime data-plane behavior was not dynamically tested because direct
  impersonation was unavailable; conclusions use exact authoritative IAM,
  predefined-role definitions, service-account IAM, and keylessness evidence;
- proof that only the immutable plan command ran relies on the hashed execution
  transcript, matching plan/result/state transition, and generation timing;
  Cloud Audit Logs were not added to this evidence set.

The final mode-`0600` inventory has SHA-256
`564e6331fed3f2243bfc2039a59414487d09148cb5e59c7a2ac37ea9aa6c7672`
and records `266` paths: `259` files, `7` directories, and zero symlinks. The
inventory itself is the two-hundred-sixty-seventh retained path. Every recorded
file hash, size, and mode matched during independent review.

All protected state/IAM backups, restoration material, immutable-plan evidence,
apply/validation evidence, and the isolated runtime remain retained. No remote
validation object exists. H3 validation has passed, but evidence cleanup remains
unauthorized until this reviewed apply record is committed and the owner
explicitly approves removing only the inventoried local paths.

### H3 evidence cleanup and closure

The independently reviewed apply/validation record was committed in `db87224`
(`docs: record application bucket hardening`) before cleanup. The owner then
explicitly approved removal of only the inventoried local H3 evidence.

The cleanup gate reverified:

- mode-`0600` inventory SHA-256
  `564e6331fed3f2243bfc2039a59414487d09148cb5e59c7a2ac37ea9aa6c7672`;
- exactly `266` unique inventoried paths under the exact
  `/tmp/palette-staging-h3-` prefix;
- exactly `259` regular files, `7` directories, and zero symlinks;
- exact equality between the current H3 path set and the inventory plus the
  inventory file;
- every recorded path type, mode, size, and file hash.

Cleanup then removed only the 259 inventoried files, removed the seven exact
inventoried directories deepest-first, and removed the inventory file last, for
exactly 267 cleanup targets. Post-cleanup verification found:

- zero `/tmp/palette-staging-h3-*` paths;
- no retained H3 state backup, IAM backup, restoration procedure, saved plan,
  show output, validation evidence, or isolated Terraform runtime;
- the pre-existing mounted staging `.terraform` cache untouched;
- unrelated working-tree files untouched and unstaged.

Cleanup executed no GCP API, Terraform backend, provider, state, plan, or apply
command and caused no remote change.

H3 is complete. Both application buckets have exact authoritative IAM,
operator administration is directly retained and validated, runtime boundaries
are explicit, public and default-account paths are absent, staging state is
drift-free at serial `12` with zero taints, bucket configuration is unchanged
apart from expected IAM metageneration, no live lock remains, and all temporary
H3 evidence is removed. Runtime positive/cross-role checks and Default Compute
denial retain their documented static-proof limitations. H4 or any other
hardening work requires a separate owner gate.

## 2026-07-24 — H4 read-only preflight and full consumer inventory

### Authorization and scope

The owner approved beginning only the H4 preflight and full consumer inventory.
This did not authorize service-account disablement, operator-initiated IAM
mutation, Terraform state mutation, API enablement, apply, or rollback. All
operator-issued cloud commands were reads, operator token reads, or a failed
impersonation attempt. No Terraform lock was acquired. First use of the already
enabled BigQuery Data Transfer API did cause documented Google-managed lazy
service-agent provisioning, recorded below; no operator or Terraform IAM write
command ran.

The active operator is `nizar.main01@gmail.com`; the configured and live project
is `palette-503123`, project number `63844374282`.

### Exact default account and IAM baseline

Live IAM data, rather than an inferred address, identifies exactly one default
Compute account:

- email: `63844374282-compute@developer.gserviceaccount.com`;
- display name: `Default compute service account`;
- unique ID: `102040098354366097620`;
- enabled, with two system-managed keys and zero user-managed keys;
- empty service-account IAM policy;
- sole project `roles/editor` member.

A project-wide Cloud Asset IAM search finds the exact principal only on the
project Editor binding. Pulled Terraform state contains no reference to it, and
`roles/editor` remains unmanaged by Terraform.

### Full attachment and consumer inventory

A project-wide, cross-location Cloud Asset search returned 168 resources across
14 asset types. The exact default-account email occurs only on its own service
account resource. Direct service inventories and the asset cross-check found:

- zero Compute Engine VMs, instance templates, and managed instance groups;
- zero Cloud Run services, jobs, and revisions;
- Cloud Functions and App Engine APIs disabled, with no corresponding assets;
- zero Cloud Build global or `us-central1` triggers, build-history entries, and
  `us-central1` worker pools, with no Cloud Build asset in another location;
- zero GKE clusters and therefore no node-pool attachment;
- zero `us-central1` Scheduler jobs and no Scheduler asset elsewhere;
- zero Pub/Sub topics, subscriptions, and snapshots;
- one `us-central1` Cloud Tasks queue, `palette-jobs`, with zero pending tasks
  and no task OIDC or OAuth attachment;
- zero `us-central1` Dataform repositories and zero BigQuery transfer configs
  in `US` or `us-central1`, with no corresponding asset elsewhere;
- Eventarc, Workflows, Batch, Dataflow, Composer, Vertex AI, Notebooks, and
  Dataproc APIs disabled and no corresponding Cloud Asset resource.

No live Palette compute or serverless workload exists yet. Existing Palette
infrastructure uses seven dedicated API, worker, task-invoker,
scheduler-invoker, build, deploy, and Terraform identities. Both authoritative
application-bucket policies contain only the operator and the dedicated
API/worker identities. Future workload deployment must still explicitly set a
dedicated runtime identity.

### Audit evidence and cadence

The revalidated complete available project Admin Activity set contains 126
entries from `2026-07-21T23:03:41.486619Z` through
`2026-07-24T04:29:48.445236Z` and did not reach the 10,000-entry query limit.
The exact default account appears in zero authenticated-principal entries and
zero token/delegation entries. A broad exact-email search returned 33 entries:
two service-account creation records and 31 project `SetIamPolicy` records where
the address is policy content, not workload execution. The additional policy
entry is the documented service-agent initialization below.

At `2026-07-24T04:29:48.445236Z`, Google's
`service-agent-manager@system.gserviceaccount.com` added exactly:

- `roles/bigquerydatatransfer.serviceAgent` →
  `serviceAccount:service-63844374282@gcp-sa-bigquerydatatransfer.iam.gserviceaccount.com`.

`bigquerydatatransfer.googleapis.com` was already enabled. The first
transfer-config query returned around `04:29:30Z`; direct `US` and
`us-central1` REST outputs were written at `04:29:49.250Z` and `04:29:49.410Z`.
The retained evidence has no request correlation ID that conclusively
identifies whether the first query initiated provisioning asynchronously or the
subsequent `US` GET crossed the initialization boundary. The `us-central1`
request completed too late to be the initial trigger.

Google documents that the [BigQuery Data Transfer service agent and its
predefined role](https://docs.cloud.google.com/bigquery/docs/enable-transfer-service)
are created automatically after the already-enabled API is used for the first
time. Google also documents that IAM audit entries from the [service-agent role
manager](https://docs.cloud.google.com/iam/docs/service-account-types#service-agents)
represent automatic role management for service agents. The
[`transferConfigs.list`](https://docs.cloud.google.com/bigquery/docs/reference/datatransfer/rest/v1/projects.transferConfigs/list)
method is an HTTP GET with an empty request body, but read-only transfer-config
semantics do not guarantee absence of first-use service initialization.

Project IAM therefore advanced from 14 to 15 bindings, adding only the standard
BigQuery Data Transfer service-agent binding. The owner classified this as
expected Google-managed lazy initialization—not an operator, Terraform, or API
enablement action—and directed that it be retained. No rollback is appropriate
merely to restore the earlier count; Google warns that removing the role breaks
the service. The binding is unrelated to the default Compute account and is not
a consumer attachment.

The locked `_Required` log bucket retains 400 days and `_Default` retains 30
days. The project has no explicit Data Access audit configuration, so absence of
data-plane entries is not standalone proof. No scheduled, periodic,
event-driven, build, task, or job consumer was found; therefore no consumer
execution cadence is known. The controlling canary window remains at least 24
hours and must be extended if the immediate pre-mutation recheck discovers a
longer cadence. Future preflights must classify first use of an enabled but
unused Google API as potentially mutating through lazy service initialization.

### State, drift, lock, and bucket baseline

A copied configuration and fresh mode-`0700` Linux `TF_DATA_DIR` kept the
mounted repository `.terraform` cache untouched. Validation is valid with zero
errors and zero warnings. The pulled state is serial `12`, lineage
`b0b96d01-e02f-c3b9-26dd-ac10aa943189`, 31 managed plus two data instances,
zero taints, and SHA-256
`bdcf32ea36350b113af4d723b0286de7bade7e173c59bbdffbd94fec6985b726`.
A full read-only plan used `-lock=false`, returned detailed exit code `0`, and
made no state write. A current lock-object describe returned `404`; no live
Terraform lock exists.

The default account is absent from both authoritative application-bucket IAM
policies. The current Editor role contains none of the seven tested
bucket/IAM/object permissions, preserving the H3 static denial result.

### Rollback preparation, evidence, and blocking issue

A fail-closed rollback procedure records the exact stage-1 re-enable sequence
and the required post-Editor-removal order: re-add only the exact Editor
membership while the account remains disabled, verify it from fresh IAM, and
re-enable only after separate owner approval. It forbids automatic rollback,
stale IAM evidence, and authoritative Terraform management of `roles/editor`.

Independent-review remediation added exact command provenance. The mode-`0600`
revalidation script has SHA-256
`6d67fc361b44f4a618ad1b55c29ec4408094d57c4012bc2ef1d7c050f351c69b`; its
mode-`0600` transcript has SHA-256
`6754955112885ba68604d9dfb579e00d8186da2ca32d31d971fc4a2704c3d1c1` and
records 47 command starts, 47 ends, and zero unexpected exit statuses. It
preserves exact argv, scopes, queries, regional arguments, audit
filters/freshness/limits/order, REST endpoints and pagination, dynamic task
enumeration, output/error paths, UTC timestamps, exit statuses, and Terraform
arguments. Expected nonzero results are limited to the denied default-account
impersonation and absent live lock object.

Protected evidence is retained under the exact mode-`0700`
`/tmp/palette-staging-h4-preflight-UhyXzm` root. The final mode-`0600`
inventory has SHA-256
`d563acf898309f479b76cbdcffaeb56c3b8b62989f9eb740f72b005d6dab91b1`
and records 234 paths: 217 files, 17 directories, and zero symlinks. The
inventory itself is the two-hundred-thirty-fifth retained path. All non-provider
evidence files are mode `0600`. No H4 evidence may be cleaned up before this
corrected record is independently reviewed and committed and the owner
separately approves cleanup of the newly inventoried exact paths.

The owner separately approved only the controlled authentication preparation:
grant the operator `roles/iam.serviceAccountTokenCreator` on the exact default
Compute service-account resource, mint one short-lived token, perform one
read-only positive-control request, and retain the resulting protected
evidence. The approval did not authorize disablement, project-level IAM
mutation, API enablement, Terraform work, workload creation, cleanup, or
rollback.

The service-account IAM policy was empty immediately before the grant. The
approved mutation added exactly:

- resource:
  `63844374282-compute@developer.gserviceaccount.com`;
- member: `user:nizar.main01@gmail.com`;
- role: `roles/iam.serviceAccountTokenCreator`.

The first token request immediately after the grant failed with
`iam.serviceAccounts.getAccessToken` denied while IAM propagated. The exact
binding was freshly verified and retained unchanged. A bounded retry then
minted a 900-second access token. Using that captured raw token, rather than a
credential helper capable of refreshing it, an authenticated
`cloudresourcemanager.projects.get` request for `palette-503123` returned HTTP
`200` and the exact project ID and number. This establishes the positive
control needed to distinguish post-disable credential rejection.

The captured token and all command results remain mode `0600`. The temporary
Token Creator binding remains attached because its removal was not authorized.
The default account remains enabled and its sole project Editor binding remains
attached. No disablement or project-level IAM mutation occurred.

The authentication mechanism is now prepared, but H4 stage 1 remains
unauthorized. A separate owner gate must bind the disablement to reuse of this
exact captured token, require rejection of that existing token and failure to
mint a new token, leave Editor attached, and define the separately authorized
removal of the temporary Token Creator grant. The Google-managed BigQuery Data
Transfer binding is retained and is not part of H4 rollback.

### H4 stage-1 default-account disable canary

The owner separately approved minting a fresh short-lived token, repeating the
positive control, disabling only the exact default Compute account while
retaining Editor, testing the same existing token and a new token request,
removing only the temporary Token Creator grant after successful denial
validation, and retaining updated evidence. Editor removal, project IAM
mutation, Terraform work, API enablement, cleanup, automatic rollback, and
commit remained unauthorized.

The fail-closed execution gate verified the exact operator, project, enabled
default account, sole Editor membership, and sole service-account-level Token
Creator binding. A fresh 900-second token then successfully repeated the exact
project-read positive control with HTTP `200` at `2026-07-24T05:08:41Z`.

The exact default account was disabled at `2026-07-24T05:08:41Z`. The disable
command succeeded, but the first immediate account description omitted
`disabled`; the sequence stopped without testing credentials or changing IAM.
A bounded read-only refresh then returned explicit `disabled: true`.

At `2026-07-24T05:09:23Z`, reuse of the exact token that had just returned
HTTP `200` instead returned HTTP `401`, status `UNAUTHENTICATED`, reason
`ACCOUNT_STATE_INVALID`, and identified the exact default-account email. A new
token request also failed with nonzero exit status and produced no token.
Together these results distinguish disabled-account rejection from missing
resource authorization.

Only after both denial checks passed, the exact temporary
`roles/iam.serviceAccountTokenCreator` membership was removed. The final
service-account IAM policy has zero bindings. A fresh project policy still has
15 bindings, with the disabled default account as the sole Editor and the
Google-managed BigQuery Data Transfer service-agent binding retained. No
Editor, project-IAM, Terraform, API, workload, cleanup, or rollback action ran.

The stage-1 canary is active. The minimum 24-hour observation window ends no
earlier than `2026-07-25T05:08:41Z` and must be extended if a longer consumer
cadence is discovered. Stage 2 remains unauthorized and must not be requested
until the observation and full consumer recheck pass.

### Stage-1 independent-review limitations

Independent review verified the live final state:

- the default Compute account is explicitly disabled;
- its service-account IAM policy is empty and the temporary Token Creator grant
  is absent;
- project IAM has 15 bindings, with the disabled default account as sole
  Editor and the Google-managed BigQuery Data Transfer service-agent binding
  retained;
- staging state remains at serial `12` with unchanged generation and zero
  taints;
- no live Terraform lock exists; and
- the evidence inventory contains 234 paths plus the inventory, with zero
  mismatches and zero symlinks.

The review identified two evidence limitations that cannot be repaired
retroactively:

1. No immediate pre-disable audit-log recheck was retained. The newest
   available audit evidence was at least 27 minutes old when disablement ran,
   so the record does not prove from contemporaneous audit logs that no
   default-account consumer appeared during that gap.
2. The evidence proves that a freshly minted default-account token received
   HTTP `200` before disablement and that a request received HTTP `401` with
   `ACCOUNT_STATE_INVALID` afterward, but it contains no retained token
   fingerprint or command transcript that independently proves both requests
   used the identical captured token.

These are evidence-chain limitations, not evidence of an active failure or an
incorrect live final state. They do not trigger automatic rollback. The
limitations must remain disclosed in the committed record, the observation
window must continue, and Stage 2 remains blocked pending the full
post-observation consumer and audit recheck.

## 2026-07-26 — H4 evidence-loss deviation and fresh post-observation validation

### Authorization and evidence-retention deviation

The original mode-`0700` Stage-1 evidence root
`/tmp/palette-staging-h4-preflight-UhyXzm` was absent when post-observation
validation began. The original raw files and the mode-`0600`
`artifact-inventory.tsv` with recorded SHA-256
`d563acf898309f479b76cbdcffaeb56c3b8b62989f9eb740f72b005d6dab91b1`
could not be recovered.

The operator recorded that read-only local searches found no exact root,
suffix, inventory filename, inventory-hash match, archive member, or open
deleted file. The operator-recorded final recursive `/tmp` result inspected
776 regular files, 21 directories, and zero symlinks; no file matched the
original inventory hash and no ZIP, TAR, or 7z archive was present. The
operator also recorded exact-name searches of the accessible Linux filesystem
and Windows `C:` and `D:` with no backup found. Raw outputs from those recovery
searches were not retained in the new durable evidence root, so these search
details are not independently reproducible evidence and are recorded as
operator results rather than a repaired evidence chain. The historical
preflight command script was recoverable from the Pi session transcript and
matches its committed SHA-256
`6d67fc361b44f4a618ad1b55c29ec4408094d57c4012bc2ef1d7c050f351c69b`, but
that transcript-derived copy is not the original raw evidence and does not
restore the inventory or evidence chain.

The owner classified the loss as an irreparable evidence-retention deviation
and approved documenting it and performing only fresh post-observation
read-only validation and complete consumer/audit rechecks. Editor removal,
service-account re-enable or disable action, IAM mutation, Terraform state
mutation, API enablement, apply, rollback, cleanup, and unrelated changes
remained unauthorized. Evidence loss did not trigger rollback or re-enablement.

The committed Stage-1 record above remains the historical record of what was
verified while the original evidence existed. Fresh evidence cannot
retroactively recreate the missing immediate pre-disable audit recheck or prove
that the historical HTTP `200` and HTTP `401` requests used the identical token.

### Durable fresh evidence and fail-closed scope

Fresh evidence is retained outside both the repository and `/tmp` under the
mode-`0700` root:

```text
/home/nkdev/.local/share/palette-evidence/h4-post-observation-20260726T044543Z
```

Sensitive evidence, scripts, summaries, and transcripts are mode `0600`. A
fresh isolated mode-`0700` Terraform configuration and `TF_DATA_DIR` are under
that root; the mounted repository `.terraform` cache remained untouched. No
plan file was saved. Evidence cleanup remains unauthorized.

A fail-closed precheck verified active operator `nizar.main01@gmail.com`, live
project `palette-503123` and project number `63844374282`, expected HEAD
`c6f63b2`, an empty index, and clean H4 runbook paths before cloud validation.
All read-only validation commands completed successfully, and account,
service-account IAM, and project IAM snapshots remained byte-identical across
the validation.

### Account and project IAM result

Fresh service-account inventory, rather than an inferred address, again found
exactly one `Default compute service account`:

- email: `63844374282-compute@developer.gserviceaccount.com`;
- unique ID: `102040098354366097620`;
- explicit live state: `disabled: true` before and after validation;
- two system-managed keys and zero user-managed keys;
- empty service-account IAM before and after validation.

Project IAM remained byte-identical at etag `BwZXU9Ku8wU=` with exactly 15
bindings. The disabled account remains the sole `roles/editor` member. Cloud
Asset IAM finds the exact principal only on that project Editor grant. Cloud
Asset resource search reports an indexed resource `state` that is not the
service account's live disabled-state field; only the byte-identical direct IAM
service-account descriptions are used as live account-state proof. The retained
Google-managed binding remains exactly:

- `roles/bigquerydatatransfer.serviceAgent` →
  `serviceAccount:service-63844374282@gcp-sa-bigquerydatatransfer.iam.gserviceaccount.com`.

No account-state, service-account IAM, project IAM, Editor, or retained
service-agent change occurred during validation.

### Complete consumer and attachment recheck

The fresh cross-location Cloud Asset inventory reports 172 resources across 16
asset types and currently surfaces two default Logging buckets and two default
Logging sinks that were absent from the historical 168-resource/14-type summary.
Those four default Logging assets are numerically consistent with the aggregate
increase, the historical record already documented the buckets, and the audit
window contains no creation or mutation event for them. Because the historical
raw asset inventory was lost, the record cannot independently exclude
same-asset-type additions or removals offsetting each other; this is a
compatibility observation, not proof that the Logging assets were the only
historical delta.

Cloud Asset exact-email resource search finds the default address only on its
own service-account resource, and Cloud Asset IAM finds it only on project
Editor. Direct inventories and the asset cross-check found:

- zero Compute Engine VMs, instance templates, and managed instance groups;
- zero Cloud Run services, jobs, and revisions;
- zero global and `us-central1` Cloud Build triggers, zero build-history
  entries, zero `us-central1` worker pools, zero `us-central1` v2 connections,
  and therefore zero connected repositories;
- zero GKE clusters and therefore zero node pools;
- zero `us-central1` Scheduler jobs;
- zero Pub/Sub topics, subscriptions, and snapshots;
- one running `us-central1` Cloud Tasks queue, `palette-jobs`, with zero
  pending tasks and therefore no pending-task OIDC or OAuth identity;
- zero `us-central1` Dataform repositories and zero BigQuery transfer configs
  in `US` and `us-central1`;
- no exact default-account email in any direct consumer output.

Cloud Functions, App Engine, Eventarc, Workflows, Batch, Dataflow, Composer,
Vertex AI, Notebooks, and Dataproc APIs remain disabled. No corresponding asset
exists, so those services were covered without enabling an API. The enabled
service set remained byte-for-byte stable at 60 services across validation.
No scheduled, periodic, event-driven, build, task, job, or workload consumer
was found, so no cadence longer than 24 hours was discovered.

### Observation and audit result

The common audit window was `2026-07-24T04:00:00Z` through
`2026-07-26T04:51:40Z`, covering 47 hours, 42 minutes, and 59 seconds after the
recorded `2026-07-24T05:08:41Z` disablement. The `_Required` bucket remains
locked at 400-day retention and `_Default` remains active at 30 days.

The complete available Admin Activity result within that window contains only
four known entries:

1. `2026-07-24T04:29:48.445236Z` — Google service-agent manager retained the
   BigQuery Data Transfer service-agent binding;
2. `2026-07-24T05:04:21.720483599Z` — the operator added the separately
   approved temporary service-account Token Creator grant;
3. `2026-07-24T05:08:40.720745824Z` — the operator disabled the exact default
   account; and
4. `2026-07-24T05:09:22.629035232Z` — the operator removed the temporary Token
   Creator grant after denial validation.

There is no later Admin Activity, system-event entry, workload error, re-enable
attempt, rollback action, Editor removal, attachment change, or other IAM
action through the audit endpoint. Four token/delegation records all precede
disablement. Eight broad exact-email references stop at the approved Token
Creator removal. There is no authenticated-principal entry for the default
account, no token/delegation event after disablement, and no approved-consumer
failure or longer execution cadence.

Cloud Logging contains no retained `ACCOUNT_STATE_INVALID` entry. The project
still has no explicit Data Access audit configuration, so absence of data-plane
entries is not standalone proof. These facts do not recreate the lost local
Stage-1 HTTP denial evidence and remain limitations rather than evidence of a
live failure.

### Terraform, bucket, and denial validation

A fresh isolated Terraform initialization and validation returned valid with
zero errors and zero warnings. The `-lock=false -detailed-exitcode` read-only
plan returned exit `0` and reported no changes. State pulls before and after the
plan were byte-identical and retained:

- serial `12`;
- lineage `b0b96d01-e02f-c3b9-26dd-ac10aa943189`;
- 31 managed plus two data instances;
- zero taints;
- SHA-256
  `bdcf32ea36350b113af4d723b0286de7bade7e173c59bbdffbd94fec6985b726`.

The live state generation remains `1784864383009458`. A current lock-object
describe returned `404`; no live Terraform lock exists.

Both application-bucket policies exactly match the H3 baseline. Input retains
operator `roles/storage.admin`, API runtime `roles/storage.objectAdmin`, and
worker runtime `roles/storage.objectViewer`; artifacts retains operator
`roles/storage.admin`, worker runtime `roles/storage.objectAdmin`, and API
runtime `roles/storage.objectViewer`. Each policy has three bindings, no
condition, no public or convenience principal, and no default Compute account.
Public-access prevention remains enforced, uniform bucket-level access remains
enabled, and both bucket metagenerations remain `4`.

The current Editor role contains none of the seven tested bucket/IAM/object
permissions. Object Admin and Object Viewer retain their intended positive and
cross-role permission boundaries. Tokenless IAM-policy and object-list requests
returned HTTP `401` on both application buckets. Together with the account's
explicitly disabled state and absence from both complete bucket policies, the
static Default Compute denial proof still passes.

### Result and retained limitations

All 38 automated validation assertions pass. The fresh post-observation
consumer, audit, IAM, Terraform, lock, bucket, public-denial, and repository
checks find no operational canary failure and no longer consumer cadence.

This result does not erase or repair:

1. the missing immediate pre-disable audit recheck;
2. the absence of retained proof that the historical HTTP `200` and HTTP `401`
   used the identical token;
3. loss of the original Stage-1 raw evidence root and inventory;
4. absence of an `ACCOUNT_STATE_INVALID` event in retained Cloud Logging; or
5. absence of explicit Data Access audit configuration.

The first independent review substantiated the fresh account/IAM, consumer,
audit, Terraform, lock, bucket, denial, and limitation results but required two
Moderate qualifications before commit: recovery-search details had to be
identified as operator-recorded rather than independently reproducible, and the
Cloud Asset aggregate comparison had to acknowledge that the lost historical
raw inventory cannot exclude offsetting same-type changes. Both corrections are
incorporated above. A fresh independent follow-up review returned `PASS` with
no remaining blocker or Moderate finding and confirmed the record is ready for
a final inventory and scoped documentation commit.

A final precommit read-only checkpoint at `2026-07-26T05:30:04Z` again found
the account explicitly disabled, service-account IAM empty, and project IAM
byte-identical at 15 bindings and etag `BwZXU9Ku8wU=`. The H4 scope still
contained only this operations-log modification and the index remained empty.

The final mode-`0600` durable inventory has SHA-256
`75ba0fd7c341a660e50d046d66ef2edf68717a1dfdfef98e23c2416f9fec81d6` and
records 216 paths excluding the inventory itself: 206 files, ten directories,
zero symlinks, and zero other path types. The inventory itself is the
217th retained path. Every recorded path, type, mode, size, and file hash
matches. All directories are mode `0700`, and all non-provider files are mode
`0600`. The isolated provider package retains only its expected non-sensitive
mode exceptions: `LICENSE.txt` at `0644` and the provider executable at `0755`.
Evidence cleanup remains unauthorized.

Upon this scoped record being committed, the operational Stage-1 disable canary
and fresh post-observation gate are classified as passed with the irreparable
evidence-retention deviation and all limitations above permanently retained.
This classification does not make the lost Stage-1 evidence complete, does not
repair any historical limitation, and does not authorize Stage 2. Stage 2
remains subject to its exact separate owner gate. No Editor removal, account
action, IAM mutation, Terraform state mutation, API enablement, apply,
rollback, or evidence cleanup occurred.

## 2026-07-26 — H4 Stage 2 default Compute Editor removal

### Separate authorization and durable evidence

After commit `7a44791` recorded the passed post-observation gate and permanently
retained the Stage-1 evidence-loss deviation and historical limitations, the
owner approved the separately presented Stage 2 gate by responding `proceed`.
The authorization allowed only removal of:

- member:
  `serviceAccount:63844374282-compute@developer.gserviceaccount.com`;
- role: `roles/editor`;
- project: `palette-503123`;
- required account state: disabled.

Service-account re-enable, any other IAM mutation, Terraform state mutation,
API enablement, apply, rollback, evidence cleanup, and unrelated changes
remained unauthorized. Rollback was not automatic.

Fresh Stage 2 evidence is retained outside the repository and `/tmp` under the
mode-`0700` root:

```text
/home/nkdev/.local/share/palette-evidence/h4-stage2-editor-removal-20260726T053351Z
```

Sensitive evidence, scripts, outputs, and transcripts are mode `0600`.
Evidence cleanup remains unauthorized.

### Read-only preflight and execution review

The Stage 2 read-only preflight completed with zero command failures and
verified:

- HEAD `7a44791aaf258dac2a0af7fa306d046596bed4c2`, an empty index,
  and clean H4 runbook paths;
- active operator `nizar.main01@gmail.com`, configured project
  `palette-503123`, and project number `63844374282`;
- exactly one live `Default compute service account`, email
  `63844374282-compute@developer.gserviceaccount.com`, unique ID
  `102040098354366097620`, and explicit `disabled: true`;
- empty service-account IAM;
- complete project IAM byte-identical to the committed baseline with 15
  bindings, etag `BwZXU9Ku8wU=`, SHA-256
  `91144d35a172b41f21c089ae2881f015d90bd57d3a8b1daa50792890c054b6b4`,
  the exact account as sole unconditional Editor, and the BigQuery Data
  Transfer service-agent binding retained;
- Cloud Asset IAM finding the exact principal only on project Editor;
- the same 60 enabled services, unchanged state generation
  `1784864383009458`, and application-bucket policies excluding the account.

The first independent pre-execution review returned `NEEDS_ATTENTION` because
the proposed post validator reduced policy bindings to role/member maps and
could miss unrelated changes to conditions, duplicate binding structure,
policy version, or audit configuration. No mutation ran. The validator was
corrected to compare the canonical complete before/after policies while
excluding only etag and normalizing ordering. It preserves policy version,
audit configuration, conditions, duplicate bindings, roles, and members, and
also compares the mutation output with a fresh post-mutation IAM read. A fresh
independent follow-up returned `PASS` and found the exact command safe under the
approved fail-closed gate.

### Exact mutation and immediate result

At `2026-07-26T05:44:56.684195442Z`, the execution gate freshly re-read the
operator, configured project, exact account, service-account IAM, and complete
project IAM. All preconditions remained byte-identical to the reviewed
preflight. The gate then executed exactly one mutating command:

```bash
gcloud projects remove-iam-policy-binding palette-503123 \
  --member=serviceAccount:63844374282-compute@developer.gserviceaccount.com \
  --role=roles/editor \
  --format=json
```

The command succeeded. Immediate post-validation at
`2026-07-26T05:45:00.638515926Z` proved:

- the exact account remained `disabled: true`;
- service-account IAM remained empty;
- project IAM changed from 15 to 14 bindings;
- `roles/editor` became absent, representing an empty Editor role;
- the complete policy differs only by removal of the exact sole Editor
  binding—policy version, audit configuration, conditions, duplicate
  structure, all other roles, and all other members are preserved;
- the command result matches the fresh post-mutation project-IAM read;
- project IAM etag advanced once from `BwZXU9Ku8wU=` to `BwZXfRs8H8o=`;
- post-policy SHA-256 is
  `8838f406a5ff1d9ff738bfca29593be4199cc89339be93739cb755e9eabf3a27`;
- `roles/bigquerydatatransfer.serviceAgent` still grants only
  `serviceAccount:service-63844374282@gcp-sa-bigquerydatatransfer.iam.gserviceaccount.com`.

The immediate Cloud Asset IAM search still returned its stale pre-mutation
Editor result. Two later read-only searches converged to zero exact-principal
IAM results. Direct project IAM is authoritative for the mutation result;
Cloud Asset remained attachment coverage and was not used as immediate live
state proof. Cloud Asset resource search continues to find the address only on
its own service-account resource.

### Post-removal audit, Terraform, and bucket validation

The mutation audit window contains exactly one Admin Activity entry:

- `2026-07-26T05:44:59.316909Z` — `SetIamPolicy` by
  `nizar.main01@gmail.com` on `projects/palette-503123`, with no error status.

No second IAM mutation or rollback appears in the initial fixed captured window,
which ended at `2026-07-26T05:46:49Z`. A final precommit requery extended the
fixed audit endpoint through `2026-07-26T06:18:56.885610654Z` and still returned
only the same one authorized event. This remains a fixed endpoint rather than
open-ended audit proof. The host clock stepped backward by approximately two
seconds around the live-state read, so nearby transcript wall-clock timestamps
are not strictly monotonic. Command order remains explicit in the transcript,
the authorized mutation is inside both audit ranges, and later direct
project-IAM snapshots remain byte-identical to the immediate post-mutation
policy. The enabled service set remains byte-identical at 60 services; no API
was enabled.

A fresh isolated mode-`0700` copied Terraform configuration and `TF_DATA_DIR`
left the mounted repository `.terraform` cache untouched. Validation passed
with zero errors and warnings. A `-lock=false -detailed-exitcode` read-only plan
returned exit `0` and reported no changes. State pulls before and after were
byte-identical and retained:

- serial `12`;
- lineage `b0b96d01-e02f-c3b9-26dd-ac10aa943189`;
- 31 managed plus two data instances;
- zero taints;
- SHA-256
  `bdcf32ea36350b113af4d723b0286de7bade7e173c59bbdffbd94fec6985b726`.

The live state generation remains `1784864383009458`; the live lock describe
returned `404`. No Terraform Editor or authoritative project-IAM declaration
exists in the ten Terraform source files inspected.

Both complete application-bucket policies remain byte-compatible with the H3
baseline: input has operator Storage Admin, API Object Admin, and worker Object
Viewer; artifacts has operator Storage Admin, worker Object Admin, and API
Object Viewer. Neither policy contains the default account, a public principal,
or a convenience principal. Location, metageneration `4`, lifecycle,
versioning, soft-delete retention, public-access prevention, and uniform
bucket-level access remain unchanged. Tokenless IAM-policy and object-list
requests returned HTTP `401` on both buckets.

The final account, service-account IAM, and project-IAM snapshots remained
byte-identical to their immediate post-mutation snapshots. All 26 automated
Stage 2 assertions pass. No service-account action, additional IAM mutation,
Terraform state mutation, API enablement, apply, rollback, evidence cleanup, or
unrelated change occurred.

### Independent review, final evidence, and commit gate

Independent post-execution review returned `PASS` with no Blocker, High, or
Moderate finding. It independently reproduced the complete policy delta,
account and service-account IAM state, one-event audit result, Cloud Asset
convergence, enabled-service stability, Terraform state/no-drift/no-lock result,
bucket policies/settings, public denial, repository scope, and preliminary
evidence inventory. Its only new note is the Low fixed-audit-window and
non-monotonic-host-clock limitation recorded above.

A final precommit checkpoint at `2026-07-26T06:18:56.885610654Z` again found
the account explicitly disabled, service-account IAM empty, project IAM
byte-identical at 14 bindings and etag `BwZXfRs8H8o=`, Cloud Asset exact-
principal IAM empty, the H4 scope limited to this operations-log change, and the
index empty.

The final mode-`0600` inventory has SHA-256
`249a4c4153bfc043b50744936aabc6c1729bc38233388fe587f9821fbdee3d1d` and
records 172 paths excluding the inventory itself: 164 files, eight directories,
zero symlinks, and zero other path types. The inventory itself is the 173rd
retained path. Every recorded path, type, mode, size, and file hash matches.
All directories are mode `0700`; all non-provider files are mode `0600`. The
isolated provider package retains only the expected non-sensitive exceptions:
`LICENSE.txt` at `0644` and the provider executable at `0755`. No evidence was
cleaned.

The Stage 2 execution and post-removal validation pass. The original Stage-1
raw-evidence loss, immediate pre-disable audit gap, identical-token proof gap,
absence of a retained `ACCOUNT_STATE_INVALID` log event, absence of explicit
Data Access audit configuration, Cloud Asset live-state limitation, and fixed
audit-window/host-clock qualification remain permanently disclosed and are not
repaired by Editor removal.

Stage 2 is complete and independently reviewed. This record is ready for the
explicitly scoped `docs: record default compute editor removal` commit. No
service-account action, additional IAM mutation, Terraform state mutation, API
enablement, apply, rollback, evidence cleanup, or unrelated change is
authorized or occurred.

## 2026-07-27 — H6-A Cloud Tasks IAM post-apply recovery and reconciliation

### Authorization, scope, and sequencing deviation

Read-only repository and GCP inspection, durable protected local evidence, and
the subsequent exact-path documentation and Terraform-definition commits were
approved. No Cloud mutation, Terraform apply/import/state mutation, IAM write,
API enablement, queue/task mutation, key or credential creation, evidence
cleanup, or H6-B workload was authorized or performed.

The three intended `palette-jobs` queue IAM member resources had already been
applied before their Terraform definitions were committed. H6-A preserved that
remote state and recorded the procedural sequencing deviation. It did not
reapply, remove, replace, import, or roll back any binding.

The recovery began from branch `dev` at
`4a1f89d169da5c4c8e83e9a031760a31b64bee5b` with an empty index and a dirty
worktree containing unrelated user changes. The exact H6 source diff contained
only:

- three added `google_cloud_tasks_queue_iam_member` resources in
  `infra/terraform/staging/main.tf`;
- one validated `cloud_tasks_queue_operator_email` variable in
  `infra/terraform/staging/variables.tf`;
- no deletion or unrelated Terraform change.

All unrelated modified, deleted, and untracked paths were preserved. The
corrected gate documentation was committed as `a1da9ff`
(`docs: split cloud tasks queue iam validation gates`) with only:

- `prodPlans/README.md`;
- `prodPlans/phases/06-staging-infrastructure.md`;
- `prodPlans/runbooks/gcp-staging-security-hardening-plan.md`.

The H6 Terraform definitions were then committed as `a0c6de9`
(`infra: define cloud tasks queue iam`) with only `main.tf` and `variables.tf`
under `infra/terraform/staging`.

### Operator, project, state, lock, and drift

Fresh direct checks confirmed active operator `nizar.main01@gmail.com`, project
`palette-503123`, project number `63844374282`, and lifecycle `ACTIVE`.
`policytroubleshooter.googleapis.com` was and remains `DISABLED`; Policy
Troubleshooter was not called or enabled.

A copied mode-`0700` Terraform configuration and isolated `TF_DATA_DIR` under
the durable evidence root left the repository `.terraform` cache untouched.
State retained:

- lineage `b0b96d01-e02f-c3b9-26dd-ac10aa943189`;
- serial `13`;
- 36 instances: 34 managed and two data instances;
- zero taints;
- canonical SHA-256
  `9543115292eaacf5bd5c6a7e57dddf2d029231b7a3c6b1aba606aa19ba7ffc1c`.

The live `staging/default.tflock` object returned `404`; no live lock existed.
A retained script proves the successful plan used `-lock=false`,
`-detailed-exitcode`, the exact project, and the reviewed existing application-
bucket operator variable. It returned exit `0` and reported:

```text
No changes. Your infrastructure matches the configuration.
```

The first isolated attempt had omitted that already-required operator variable
and stopped before planning with exit `1`; the corrected fresh plan passed. A
post-plan state pull serialized the two validation `check_results` entries in a
different order, while serial, lineage, instances, taints, and values remained
unchanged. A confirming pull returned the canonical byte-identical state hash,
so the difference was serialization order rather than a backend state change.

### Complete queue and inherited IAM reconciliation

The complete direct queue policy is version `1`, etag `BwZXfyI6Aac=`, and has
exactly three unconditional bindings:

- `roles/cloudtasks.admin` → `user:nizar.main01@gmail.com`;
- `roles/cloudtasks.enqueuer` →
  `serviceAccount:palette-api-runtime@palette-503123.iam.gserviceaccount.com`;
- `roles/cloudtasks.queueAdmin` →
  `serviceAccount:palette-terraform@palette-503123.iam.gserviceaccount.com`.

Pre/post direct policies were equal with the same etag. The project has no
folder or organization parent, so the project allow policy is the only
applicable ancestor policy. All 14 project-bound predefined roles were freshly
inspected. Only project `roles/owner`, held by
`user:nizar.main01@gmail.com`, includes Cloud Tasks API permissions; the
expected Cloud Tasks service-agent binding is also present. Operator success
therefore cannot be attributed solely to the queue-level Admin binding while
the operator remains project Owner.

Current predefined role definitions were captured directly. Queue Admin has 14
permissions, including queue create, delete, get, IAM read/write, list, update,
pause, purge, and resume, with no task create or list permission. Enqueuer has
five permissions and includes task creation but not task listing or queue
administration. Admin has 24 permissions and includes queue and task
administration. Cloud Asset was used only as eventual-consistency
corroboration; it returned the same three queue bindings, project service-agent
binding, and queue asset.

### Queue configuration and Terraform-principal validation

Complete pre/post queue responses are byte-identical with SHA-256
`c1bf41ceef28fe552507ee6cc0356dd71d0d29646f287b23ac647cc99ba2117a`.
`palette-jobs` remained `RUNNING` and empty with:

- location `us-central1`;
- max burst `10`, max concurrent dispatches `3`, and max dispatch rate `1.0`
  per second;
- max attempts `3`, max retry duration `1800s`, backoff `10s` through `300s`,
  and max doublings `5`;
- logging sampling ratio `1.0`;
- no additional queue/deadline-related field in either complete response.

Using only the existing approved keyless impersonation path for
`palette-terraform`, queue configuration and IAM reads succeeded and matched
the operator reads. Queue `testIamPermissions` returned HTTP `200` and granted:

- `cloudtasks.queues.delete`;
- `cloudtasks.queues.get`;
- `cloudtasks.queues.getIamPolicy`;
- `cloudtasks.queues.pause`;
- `cloudtasks.queues.purge`;
- `cloudtasks.queues.resume`;
- `cloudtasks.queues.setIamPolicy`;
- `cloudtasks.queues.update`.

It excluded `cloudtasks.tasks.create` and `cloudtasks.tasks.list`. A direct
read-only task-list call as `palette-terraform` returned exit `1` with
`PERMISSION_DENIED` for `cloudtasks.tasks.list`. No denied mutating method was
called.

### Audit, key, and federation reconciliation

Available Admin Activity from `2026-07-26T00:00:00Z` through the final recovery
read contained four events and was unchanged between initial and final reads.
The three H6 events were successful operator-authenticated queue
`SetIamPolicy` calls:

1. `2026-07-26T08:09:58.804849324Z` — added Terraform Queue Admin;
2. `2026-07-26T08:10:02.744401791Z` — added operator Admin while retaining
   Terraform Queue Admin;
3. `2026-07-26T08:10:06.806205780Z` — added API Enqueuer, producing the exact
   final three-binding policy.

The fourth, earlier project `SetIamPolicy` event at
`2026-07-26T05:44:59.316909Z` is the separately recorded H4 project-IAM change.
No later Admin Activity, unexpected queue mutation, service-account IAM
mutation, Token Creator mutation, federation mutation, or API enablement
appeared. Admin Activity is control-plane evidence within the queried retained
window and is not standalone Data Access evidence.

All eight project service accounts have zero user-managed keys: the seven
Palette accounts and the disabled default Compute account. Direct service-
account policies contain no federation principal and no Workload Identity User
or OpenID-token-creator grant. The only Token Creator binding is the existing
approved operator-to-`palette-terraform` impersonation path. Workload Identity
Pool inventory is empty. Project and Palette service-account IAM/key snapshots
remained equal across pre/post reads.

### Durable evidence, independent review, and retained gate

Evidence is retained outside the repository and `/tmp` under the mode-`0700`
root:

```text
/home/nkdev/.local/share/palette-evidence/h6a-reconciliation-20260727T063533Z
```

All directories are mode `0700`; all files, including the isolated provider,
are mode `0600`. The mode-`0600` inventory has SHA-256
`76a65e04d2406d3abc16257edc52798e564f8441a2a41c7ab5fa573c1cbdb641`
and records 212 paths excluding the inventory and hash sidecar: 204 files,
eight directories, zero symlinks, and zero other path types. Independent
review verified every recorded mode, size, and file hash and returned PASS with
no remaining H6-A blocker. Evidence cleanup remains unauthorized.

H6-A reconciliation passes. The early IAM-apply sequencing deviation,
operator-Owner attribution limitation, Cloud Asset lag limitation, retained
Admin Activity scope, and deferred real deployed-principal/OIDC validation
remain disclosed. H6-A does not complete H6, and H7 remains blocked. H6-B must
not begin until the corrected Phase 03–05, scanning, Cloud Run, keyless CI and
deployment, Tasks OIDC, and Scheduler OIDC prerequisites exist and receive a
separate authorization.

The retained status is exactly:

```text
IAM configuration applied; deployed-principal validation pending.
```

## 2026-07-27 — H5 container vulnerability scanning deferred

### Owner decision and accepted limitation

The owner chose not to pay for or enable automatic or on-demand GCP container
vulnerability scanning. The expected deployment image is a deliberately
selected Chromium-based container and the anticipated number of unique images
is low. This reduces expected scan volume but does not prove the selected image
or its Chromium, operating-system, native-library, or application dependencies
are free of known vulnerabilities.

This decision concerns deployable Docker/OCI images in Artifact Registry. It
does not concern PNG, JPEG, or other user-uploaded application content. H5 is
recorded on the scanning-deferred path as an intentional launch blocker, not as
a passed scanning control.

### Fresh read-only GCP state

Direct read-only inspection of project `palette-503123` returned successfully
and confirmed:

- `containerscanning.googleapis.com` is disabled;
- `ondemandscanning.googleapis.com` is disabled;
- `containeranalysis.googleapis.com` is disabled;
- `palette-containers` remains a Docker repository in `us-central1`;
- repository vulnerability scanning reports `SCANNING_DISABLED` because the
  Container Scanning API is not enabled;
- the repository contains zero container images.

No API, repository setting, image, IAM policy, Terraform state, workload, or
other Cloud resource was changed. No scanning cost was incurred or approved.

### Deferred gate

Artifact Registry image publishing and deployment promotion remain blocked
under the current security-hardening plan. H6-B must not start and H7 cannot
pass while scanning remains deferred. Local implementation may continue in the
declared Phase 01 through Phase 05 dependency order, but it does not authorize
an image push, Cloud Run deployment, validation workload, or exception.

Reconsidering this decision requires a separate owner approval that defines the
scanner mode, numeric digest or invocation ceiling, maximum spend, blocking
severity, exact-digest fail-closed behavior, and deployment evidence. Until
then, the retained H6 status remains exactly:

```text
IAM configuration applied; deployed-principal validation pending.
```

## 2026-07-27 — H5 scanning-disabled deployment risk accepted

### Owner risk acceptance

The owner subsequently approved revising the production plan to keep GCP
container vulnerability scanning disabled while allowing future image
publishing and deployment after the remaining gates pass. The owner accepts the
residual risk that an operator-selected Chromium container, its base operating
system, native libraries, browser, and application dependencies may contain
known or subsequently disclosed vulnerabilities that no GCP scan identifies.

This decision supersedes only the launch-blocking effect of the immediately
preceding scanning-deferred entry. It does not claim that H5 scanning passed,
does not claim an image is vulnerability-free, and does not authorize a current
image push, deployment, H6-B validation workload, production promotion, API
enablement, or other Cloud mutation.

### Required substitute controls

While this risk acceptance remains active, every promoted image must:

- use approved upstream base images and a final deployment image pinned by
  immutable digest;
- install application dependencies from frozen lockfiles;
- retain SBOM and provenance for the exact promoted digest;
- run non-root with sandboxed Chromium and least-privilege runtime IAM;
- contain no secret in source, build arguments, layers, or logged runtime
  configuration;
- be reviewed against upstream Chromium and base-image security notices before
  promotion and rebuilt promptly after an upstream security update;
- retain a previous known-operational digest and pass rollback validation before
  production promotion;
- deploy and promote by digest, never by mutable tag.

The existing source, dependency, secret, IaC, sandbox, IAM, OIDC, and deployed
security checks remain mandatory. Disabling GCP container vulnerability
scanning is not an exemption from those controls.

### Revised gate and mutation accounting

The security-hardening runbook, canonical production plan, and Phase 06 plan
were revised together so the higher- and lower-authority documents agree. The
scanning-disabled risk acceptance now satisfies only the H5 image-policy
prerequisite. Phases 03–05, the minimum Phase 06 keyless Cloud Run/Cloud Build,
Tasks OIDC and Scheduler OIDC paths, and a separate H6-B workload approval
remain required before H6-B.

The scanning APIs and repository scanning configuration remain disabled. This
plan revision made no GCP API call that mutates state and performed no image
push, deployment, workload execution, IAM change, Terraform state change, API
enablement, or cost-incurring action.

The retained H6 status remains exactly:

```text
IAM configuration applied; deployed-principal validation pending.
```

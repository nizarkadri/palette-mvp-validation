locals {
  name_prefix   = "palette-${var.environment}"
  bucket_suffix = replace(var.project_id, "-", "")

  required_services = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudtasks.googleapis.com",
    "firestore.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "identitytoolkit.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ])
}

resource "google_project_service" "required" {
  for_each = local.required_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "containers" {
  project       = var.project_id
  location      = var.region
  repository_id = "palette-containers"
  description   = "Palette staging container images."
  format        = "DOCKER"
  labels        = var.common_labels

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket" "input" {
  project                     = var.project_id
  name                        = "${local.name_prefix}-input-${local.bucket_suffix}"
  location                    = var.storage_location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = var.common_labels

  versioning {
    enabled = false
  }

  lifecycle_rule {
    condition {
      age = 1
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket" "artifacts" {
  project                     = var.project_id
  name                        = "${local.name_prefix}-artifacts-${local.bucket_suffix}"
  location                    = var.storage_location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = var.common_labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_service_account" "api_runtime" {
  project      = var.project_id
  account_id   = "palette-api-runtime"
  display_name = "Palette API runtime (${var.environment})"
  description  = "Least-privilege runtime identity for the public API service."

  depends_on = [google_project_service.required]
}

resource "google_service_account" "worker_runtime" {
  project      = var.project_id
  account_id   = "palette-worker-runtime"
  display_name = "Palette worker runtime (${var.environment})"
  description  = "Least-privilege runtime identity for the private worker service."

  depends_on = [google_project_service.required]
}

resource "google_service_account" "tasks_invoker" {
  project      = var.project_id
  account_id   = "palette-tasks-invoker"
  display_name = "Palette Cloud Tasks OIDC invoker (${var.environment})"
  description  = "OIDC identity used by Cloud Tasks to invoke the private worker."

  depends_on = [google_project_service.required]
}

resource "google_service_account" "scheduler_invoker" {
  project      = var.project_id
  account_id   = "palette-scheduler-invoker"
  display_name = "Palette scheduler OIDC invoker (${var.environment})"
  description  = "OIDC identity used by Cloud Scheduler for reconciliation."

  depends_on = [google_project_service.required]
}

resource "google_service_account" "build" {
  project      = var.project_id
  account_id   = "palette-build"
  display_name = "Palette build identity (${var.environment})"
  description  = "Dedicated identity for Cloud Build; roles are assigned with the delivery pipeline."

  depends_on = [google_project_service.required]
}

resource "google_service_account" "deploy" {
  project      = var.project_id
  account_id   = "palette-deploy"
  display_name = "Palette deploy identity (${var.environment})"
  description  = "Dedicated deployment identity; roles and actAs scope are assigned with the delivery pipeline."

  depends_on = [google_project_service.required]
}

resource "google_service_account" "terraform" {
  project      = var.project_id
  account_id   = "palette-terraform"
  display_name = "Palette Terraform identity (${var.environment})"
  description  = "Dedicated future Terraform automation identity; no roles or keys are assigned initially."

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "openrouter_api_key" {
  project   = var.project_id
  secret_id = "palette-openrouter-api-key"
  labels    = var.common_labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "worker_openrouter_secret_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.openrouter_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.worker_runtime.member
}

data "google_iam_policy" "input_bucket" {
  binding {
    role = "roles/storage.admin"
    members = [
      "user:${var.application_bucket_operator_email}",
    ]
  }

  binding {
    role = "roles/storage.objectAdmin"
    members = [
      google_service_account.api_runtime.member,
    ]
  }

  binding {
    role = "roles/storage.objectViewer"
    members = [
      google_service_account.worker_runtime.member,
    ]
  }
}

resource "google_storage_bucket_iam_policy" "input" {
  bucket      = google_storage_bucket.input.name
  policy_data = data.google_iam_policy.input_bucket.policy_data
}

data "google_iam_policy" "artifacts_bucket" {
  binding {
    role = "roles/storage.admin"
    members = [
      "user:${var.application_bucket_operator_email}",
    ]
  }

  binding {
    role = "roles/storage.objectAdmin"
    members = [
      google_service_account.worker_runtime.member,
    ]
  }

  binding {
    role = "roles/storage.objectViewer"
    members = [
      google_service_account.api_runtime.member,
    ]
  }
}

resource "google_storage_bucket_iam_policy" "artifacts" {
  bucket      = google_storage_bucket.artifacts.name
  policy_data = data.google_iam_policy.artifacts_bucket.policy_data
}

resource "google_cloud_tasks_queue" "palette_jobs" {
  project  = var.project_id
  name     = "palette-jobs"
  location = var.region

  rate_limits {
    max_concurrent_dispatches = 3
    max_dispatches_per_second = 1
  }

  retry_config {
    max_attempts       = 3
    max_retry_duration = "1800s"
    min_backoff        = "10s"
    max_backoff        = "300s"
    max_doublings      = 5
  }

  stackdriver_logging_config {
    sampling_ratio = 1
  }

  depends_on = [google_project_service.required]
}

resource "google_cloud_tasks_queue_iam_member" "api_enqueuer" {
  project  = google_cloud_tasks_queue.palette_jobs.project
  location = google_cloud_tasks_queue.palette_jobs.location
  name     = google_cloud_tasks_queue.palette_jobs.name
  role     = "roles/cloudtasks.enqueuer"
  member   = google_service_account.api_runtime.member
}

resource "google_cloud_tasks_queue_iam_member" "operator_admin" {
  project  = google_cloud_tasks_queue.palette_jobs.project
  location = google_cloud_tasks_queue.palette_jobs.location
  name     = google_cloud_tasks_queue.palette_jobs.name
  role     = "roles/cloudtasks.admin"
  member   = "user:${var.cloud_tasks_queue_operator_email}"
}

resource "google_cloud_tasks_queue_iam_member" "terraform_queue_admin" {
  project  = google_cloud_tasks_queue.palette_jobs.project
  location = google_cloud_tasks_queue.palette_jobs.location
  name     = google_cloud_tasks_queue.palette_jobs.name
  role     = "roles/cloudtasks.queueAdmin"
  member   = google_service_account.terraform.member
}

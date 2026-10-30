output "project_id" {
  description = "Staging project ID managed by this Terraform root."
  value       = var.project_id
}

output "region" {
  description = "Primary staging region."
  value       = var.region
}

output "artifact_registry_repository" {
  description = "Docker Artifact Registry repository resource name."
  value       = google_artifact_registry_repository.containers.name
}

output "input_bucket" {
  description = "Private upload/input bucket."
  value       = google_storage_bucket.input.name
}

output "artifacts_bucket" {
  description = "Private generated artifacts bucket."
  value       = google_storage_bucket.artifacts.name
}

output "cloud_tasks_queue" {
  description = "Cloud Tasks queue for palette jobs."
  value       = google_cloud_tasks_queue.palette_jobs.id
}

output "runtime_service_accounts" {
  description = "Runtime and invoker service account emails."
  value = {
    api_runtime       = google_service_account.api_runtime.email
    worker_runtime    = google_service_account.worker_runtime.email
    tasks_invoker     = google_service_account.tasks_invoker.email
    scheduler_invoker = google_service_account.scheduler_invoker.email
  }
}

output "automation_service_accounts" {
  description = "Build, deploy, and future Terraform automation service account emails."
  value = {
    build     = google_service_account.build.email
    deploy    = google_service_account.deploy.email
    terraform = google_service_account.terraform.email
  }
}

output "openrouter_secret_id" {
  description = "Secret Manager secret resource for the OpenRouter API key. Add secret versions out of band only."
  value       = google_secret_manager_secret.openrouter_api_key.id
}

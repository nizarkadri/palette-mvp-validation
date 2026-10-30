output "state_bucket_name" {
  description = "GCS bucket for Terraform remote state."
  value       = google_storage_bucket.terraform_state.name
}

output "staging_backend_hint" {
  description = "Backend configuration to use from infra/terraform/staging after bootstrap apply."
  value = {
    bucket = google_storage_bucket.terraform_state.name
    prefix = "staging"
  }
}

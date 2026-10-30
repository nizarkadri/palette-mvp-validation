variable "project_id" {
  description = "Google Cloud project that owns Terraform state."
  type        = string
}

variable "region" {
  description = "Primary region for bootstrap provider operations."
  type        = string
  default     = "us-central1"
}

variable "state_bucket_name" {
  description = "Globally unique GCS bucket name for Terraform remote state."
  type        = string
}

variable "state_bucket_location" {
  description = "Location for the Terraform state bucket."
  type        = string
  default     = "US-CENTRAL1"
}

variable "state_operator_email" {
  description = "Exact operator principal that retains emergency administration of Terraform state."
  type        = string
}

variable "common_labels" {
  description = "Common labels applied to supported resources."
  type        = map(string)
  default = {
    app         = "palette"
    environment = "staging"
    managed_by  = "terraform"
    purpose     = "tfstate"
  }
}

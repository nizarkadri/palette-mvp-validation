variable "project_id" {
  description = "Existing Google Cloud project ID for the staging environment."
  type        = string
}

variable "region" {
  description = "Primary region for regional staging resources."
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment name used in resource labels and names."
  type        = string
  default     = "staging"
}

variable "alert_email" {
  description = "Operator email address used in labels/docs and budget notifications once a non-zero budget is approved."
  type        = string
  default     = "nizar.main01@gmail.com"
}

variable "application_bucket_operator_email" {
  description = "Exact operator principal that retains emergency administration of application buckets."
  type        = string

  validation {
    condition     = var.application_bucket_operator_email == "nizar.main01@gmail.com"
    error_message = "application_bucket_operator_email must be the reviewed operator nizar.main01@gmail.com."
  }
}

variable "cloud_tasks_queue_operator_email" {
  description = "Exact operator principal that retains Cloud Tasks queue administration."
  type        = string
  default     = "nizar.main01@gmail.com"

  validation {
    condition     = var.cloud_tasks_queue_operator_email == "nizar.main01@gmail.com"
    error_message = "cloud_tasks_queue_operator_email must be the reviewed operator nizar.main01@gmail.com."
  }
}

variable "storage_location" {
  description = "Location for regional Cloud Storage buckets."
  type        = string
  default     = "US-CENTRAL1"
}

variable "common_labels" {
  description = "Common labels applied to supported resources."
  type        = map(string)
  default = {
    app         = "palette"
    environment = "staging"
    managed_by  = "terraform"
  }
}

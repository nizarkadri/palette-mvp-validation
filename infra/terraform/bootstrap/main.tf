resource "google_project_service" "storage" {
  project            = var.project_id
  service            = "storage.googleapis.com"
  disable_on_destroy = false
}

resource "google_storage_bucket" "terraform_state" {
  project                     = var.project_id
  name                        = var.state_bucket_name
  location                    = var.state_bucket_location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = var.common_labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age                = 30
      num_newer_versions = 10
      with_state         = "ARCHIVED"
    }

    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.storage]
}

data "google_service_account" "terraform" {
  project    = var.project_id
  account_id = "palette-terraform"
}

data "google_iam_policy" "terraform_state" {
  binding {
    role = "roles/storage.admin"
    members = [
      "user:${var.state_operator_email}",
    ]
  }

  binding {
    role = "roles/storage.objectAdmin"
    members = [
      data.google_service_account.terraform.member,
    ]
  }
}

resource "google_storage_bucket_iam_policy" "terraform_state" {
  bucket      = google_storage_bucket.terraform_state.name
  policy_data = data.google_iam_policy.terraform_state.policy_data
}

resource "google_service_account_iam_member" "operator_terraform_token_creator" {
  service_account_id = data.google_service_account.terraform.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.state_operator_email}"
}

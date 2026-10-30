terraform {
  backend "gcs" {
    bucket = "palette-staging-tfstate-palette503123"
    prefix = "staging"
  }
}

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Local backend by default so this works with zero extra setup.
  # Once you have a GCP project, create a GCS bucket and switch to:
  #
  # backend "gcs" {
  #   bucket = "<your-tfstate-bucket>"
  #   prefix = "pbl-api"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

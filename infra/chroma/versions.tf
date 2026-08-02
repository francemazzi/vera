terraform {
  required_version = ">= 1.7.0"

  # Backend coordinates are supplied at init time so the same reviewed module
  # can be used per environment without committing a project-specific bucket.
  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "current" {}

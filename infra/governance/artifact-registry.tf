// The governance image repository is intentionally separate from the Chroma
// repository. Cloud Run receives reader access only on this repository, while
// the explicitly supplied CI execution identity receives writer access only
// here.
resource "google_artifact_registry_repository" "governance" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_repository_id
  description   = "Reviewed, digest-pinned VERA governance worker images for SILTO Label"
  format        = "DOCKER"

  depends_on = [google_project_service.required["artifactregistry.googleapis.com"]]
}

resource "google_artifact_registry_repository_iam_member" "cloud_run_reader" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.governance.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-${data.google_project.current.number}@serverless-robot-prod.iam.gserviceaccount.com"
}

resource "google_artifact_registry_repository_iam_member" "cloud_build_writer" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.governance.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${var.cloud_build_service_account_email}"
}

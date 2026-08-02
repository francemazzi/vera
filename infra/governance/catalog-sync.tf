// The scheduler has no browser-facing authority. It calls the narrow,
// OIDC-protected backend endpoint that only observes the curated catalogue
// and creates new UNVERIFIED candidates when an official source changes.
resource "google_service_account" "catalog_sync" {
  account_id   = "silto-label-catalog-sync"
  display_name = "SILTO Label regulatory catalog monthly sync"

  depends_on = [google_project_service.required]
}

// This is deliberately a member-level binding: it grants only the dedicated
// scheduler identity permission to reach the backend Cloud Run service, and
// leaves every existing backend IAM binding unchanged.
resource "google_cloud_run_v2_service_iam_member" "catalog_sync_backend_invoker" {
  project  = var.project_id
  name     = var.backend_service_name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.catalog_sync.email}"
}

resource "google_cloud_scheduler_job" "catalog_monthly_sync" {
  project          = var.project_id
  region           = var.region
  name             = "silto-label-catalog-monthly-sync"
  description      = "Monthly, OIDC-authenticated refresh of the private Food Consulting regulatory catalogue."
  schedule         = var.catalog_sync_schedule
  time_zone        = var.catalog_sync_time_zone
  attempt_deadline = "300s"
  // The first controlled batch is explicitly reviewed before automation is
  // enabled. Terraform still creates the immutable job and its identity so
  // enabling it is a small, auditable configuration change. All three gates
  // must be true: this Terraform intent, deployed backend feature flags, and
  // a reviewed dedicated audit actor. A flag in one system cannot activate
  // recurring external fetches by itself.
  paused = !local.catalog_sync_ready

  retry_config {
    // The backend currently performs a bounded, synchronous observation.
    // Avoid overlapping retries after the 300-second deadline; the next
    // monthly idempotent run or an explicit operator retry is safer.
    retry_count = 0
  }

  http_target {
    http_method = "POST"
    uri         = "${trimsuffix(var.backend_url, "/")}/internal/label/sources/catalog/sync"

    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.catalog_sync.email
      audience              = var.backend_audience
    }
  }

  depends_on = [
    google_project_service.required,
    google_cloud_run_v2_service_iam_member.catalog_sync_backend_invoker,
  ]
}

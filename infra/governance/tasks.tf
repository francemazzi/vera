// Cloud Tasks isolates materialization, classification, and Chroma indexing
// from request handling. The queue carries only private job identifiers; the
// durable candidate remains recoverable when a task reaches its retry limit.
resource "google_service_account" "governance_tasks" {
  account_id   = "silto-label-governance-tasks"
  display_name = "SILTO Label governance Cloud Tasks OIDC invoker"

  depends_on = [google_project_service.required]
}

resource "google_cloud_tasks_queue" "governance" {
  project  = var.project_id
  location = var.region
  name     = var.governance_tasks_queue_name

  rate_limits {
    max_dispatches_per_second = var.governance_tasks_max_dispatches_per_second
    max_concurrent_dispatches = var.governance_tasks_max_concurrent_dispatches
  }

  retry_config {
    max_attempts       = var.governance_tasks_max_attempts
    max_retry_duration = "86400s"
    min_backoff        = "30s"
    max_backoff        = "900s"
    max_doublings      = 5
  }

  // Job payloads contain only opaque IDs, but logging is kept complete for
  // incident investigation and queue/retry monitoring.
  stackdriver_logging_config {
    sampling_ratio = 1
  }

  depends_on = [google_project_service.required]
}

// Discovery is intentionally isolated from materialization/classification and
// Chroma indexing. A slow legislative portal can consume this conservative
// lane without delaying a human-verified source's later RAG operation.
resource "google_cloud_tasks_queue" "source_discovery" {
  project  = var.project_id
  location = var.region
  name     = var.source_discovery_tasks_queue_name

  rate_limits {
    max_dispatches_per_second = var.source_discovery_tasks_max_dispatches_per_second
    max_concurrent_dispatches = var.source_discovery_tasks_max_concurrent_dispatches
  }

  retry_config {
    max_attempts       = var.source_discovery_tasks_max_attempts
    max_retry_duration = "86400s"
    min_backoff        = "60s"
    max_backoff        = "1800s"
    max_doublings      = 5
  }

  stackdriver_logging_config {
    sampling_ratio = 1
  }

  depends_on = [google_project_service.required]
}

// The backend can enqueue only into this queue. It is not granted project-wide
// task administration. Cloud Tasks, not the backend, mints the OIDC token at
// dispatch time.
resource "google_cloud_tasks_queue_iam_member" "backend_enqueuer" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.governance.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${var.backend_service_account_email}"
}

resource "google_cloud_tasks_queue_iam_member" "backend_source_discovery_enqueuer" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.source_discovery.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${var.backend_service_account_email}"
}

// Cloud Tasks itself mints the request token at dispatch time. Bind this only
// to the Google-managed Cloud Tasks service agent, never to a broad project
// role or user-managed runtime identity.
resource "google_service_account_iam_member" "cloud_tasks_service_agent_can_act_as_task_invoker" {
  service_account_id = google_service_account.governance_tasks.name
  role               = "roles/iam.serviceAccountUser"
  member             = local.cloud_tasks_service_agent_member
}

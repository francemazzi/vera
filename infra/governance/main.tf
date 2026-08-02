locals {
  required_services = toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudtasks.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "vpcaccess.googleapis.com",
  ])
  # Cloud Run's generated default URL is stable for a service/project/region.
  service_audience                 = "https://${var.service_name}-${data.google_project.current.number}.${var.region}.run.app"
  catalog_sync_ready               = var.catalog_sync_enabled && var.catalog_sync_backend_flag_confirmed && var.catalog_sync_actor_confirmed
  cloud_tasks_service_agent_member = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-cloudtasks.iam.gserviceaccount.com"
}

resource "google_project_service" "required" {
  for_each           = local.required_services
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "governance" {
  account_id   = "silto-vera-governance"
  display_name = "SILTO VERA private source governance worker"
  depends_on   = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "openrouter_reader" {
  secret_id = var.openrouter_api_key_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.governance.email}"
}

resource "google_secret_manager_secret_iam_member" "database_reader" {
  secret_id = var.database_url_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.governance.email}"
}

resource "google_secret_manager_secret_iam_member" "chroma_token_reader" {
  count     = var.chroma_token_secret_id == null ? 0 : 1
  secret_id = var.chroma_token_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.governance.email}"
}

# Read existing direct uploads and create immutable URL-download/text objects.
resource "google_storage_bucket_iam_member" "source_reader" {
  bucket = var.label_bucket_name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.governance.email}"
}

resource "google_storage_bucket_iam_member" "source_creator" {
  bucket = var.label_bucket_name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.governance.email}"
}

resource "google_cloud_run_v2_service" "governance" {
  name     = var.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  # Cloud Run materializes service-level automatic scaling defaults even
  # though this deployment intentionally controls scaling on the revision
  # template below. Ignoring that generated block prevents a no-op revision
  # rollout on every Terraform plan.
  lifecycle {
    ignore_changes = [scaling]
  }

  template {
    service_account = google_service_account.governance.email
    timeout         = "300s"

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instance_count
    }

    vpc_access {
      connector = var.serverless_vpc_connector
      # Keeps OpenRouter egress behind the VPC's Cloud NAT and makes the
      # Chroma RFC1918 endpoint reachable without a public listener.
      egress = "ALL_TRAFFIC"
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
      }

      env {
        name  = "GOVERNANCE_AUDIENCE"
        value = local.service_audience
      }
      env {
        name  = "GOVERNANCE_BACKEND_SERVICE_ACCOUNT_EMAIL"
        value = var.backend_service_account_email
      }
      env {
        name  = "GOVERNANCE_BACKEND_URL"
        value = var.backend_url
      }
      env {
        name  = "GOVERNANCE_BACKEND_AUDIENCE"
        value = var.backend_audience
      }
      env {
        name  = "GOVERNANCE_GCS_BUCKET"
        value = var.label_bucket_name
      }
      env {
        name  = "GOVERNANCE_DATABASE_SCHEMA"
        value = var.database_schema
      }
      env {
        name  = "CHROMA_ENDPOINT"
        value = var.chroma_endpoint
      }
      env {
        name  = "CHROMA_TENANT"
        value = var.chroma_tenant
      }
      env {
        name  = "CHROMA_DATABASE"
        value = var.chroma_database
      }
      env {
        name  = "LABEL_SOURCE_ALLOWED_PDF_HOSTS"
        value = var.allowed_pdf_hosts
      }
      env {
        name  = "GOVERNANCE_OPENROUTER_TIMEOUT_MS"
        value = "60000"
      }
      env {
        name  = "CHROMA_TIMEOUT_MS"
        value = "30000"
      }
      env {
        name = "OPENROUTER_API_KEY"
        value_source {
          secret_key_ref {
            secret  = var.openrouter_api_key_secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = var.database_url_secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "GOVERNANCE_TASKS_INVOKER_SERVICE_ACCOUNT_EMAIL"
        value = google_service_account.governance_tasks.email
      }

      dynamic "env" {
        for_each = var.chroma_token_secret_id == null ? [] : [var.chroma_token_secret_id]
        content {
          name = "CHROMA_TOKEN"
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_artifact_registry_repository_iam_member.cloud_run_reader,
    google_secret_manager_secret_iam_member.openrouter_reader,
    google_secret_manager_secret_iam_member.database_reader,
    google_storage_bucket_iam_member.source_reader,
    google_storage_bucket_iam_member.source_creator,
  ]
}

# No allUsers/allAuthenticatedUsers binding is created. These are the only
# identities permitted to invoke the private Cloud Run service through IAM.
resource "google_cloud_run_v2_service_iam_member" "backend_invoker" {
  name     = google_cloud_run_v2_service.governance.name
  location = google_cloud_run_v2_service.governance.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.backend_service_account_email}"
}

resource "google_cloud_run_v2_service_iam_member" "tasks_invoker" {
  name     = google_cloud_run_v2_service.governance.name
  location = google_cloud_run_v2_service.governance.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.governance_tasks.email}"
}

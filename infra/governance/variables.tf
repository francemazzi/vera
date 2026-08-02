variable "project_id" {
  description = "GCP project containing the private governance service."
  type        = string
}

variable "region" {
  description = "Cloud Run region; use the same region as the private Chroma connector."
  type        = string
  default     = "europe-west1"
}

variable "service_name" {
  description = "Private Cloud Run service name."
  type        = string
  default     = "silto-vera-governance"
}

variable "artifact_repository_id" {
  description = "Artifact Registry Docker repository that contains the digest-pinned governance image."
  type        = string
  default     = "silto-governance"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,62}$", var.artifact_repository_id))
    error_message = "artifact_repository_id must be a valid Artifact Registry repository identifier."
  }
}

variable "cloud_build_service_account_email" {
  description = "Cloud Build execution service account granted writer only on the governance Artifact Registry repository."
  type        = string
}

variable "image" {
  description = "Immutable Artifact Registry image reference for the governance worker."
  type        = string

  validation {
    condition     = can(regex("^.+@sha256:[0-9a-f]{64}$", var.image))
    error_message = "image must be a digest-pinned container reference."
  }
}

variable "serverless_vpc_connector" {
  description = "Serverless VPC Access connector ID output by infra/chroma."
  type        = string
}

variable "chroma_endpoint" {
  description = "Private Chroma endpoint output by infra/chroma; never publish it to the browser."
  type        = string
}

variable "chroma_tenant" {
  description = "Non-secret Chroma tenant identifier."
  type        = string
  default     = "default_tenant"
}

variable "chroma_database" {
  description = "Non-secret Chroma database identifier."
  type        = string
  default     = "default_database"
}

variable "chroma_token_secret_id" {
  description = "Optional Secret Manager secret ID for a Chroma proxy token. Leave null for network-only VM access."
  type        = string
  default     = null
  nullable    = true
}

variable "openrouter_api_key_secret_id" {
  description = "Existing Secret Manager secret ID containing OPENROUTER_API_KEY."
  type        = string
}

variable "database_url_secret_id" {
  description = "Existing Secret Manager secret ID containing the VERA governance DATABASE_URL."
  type        = string
}

variable "database_schema" {
  description = "Dedicated PostgreSQL schema used by VERA's tables and Prisma migration ledger."
  type        = string
  default     = "vera"

  validation {
    condition     = can(regex("^[A-Za-z_][A-Za-z0-9_]*$", var.database_schema))
    error_message = "database_schema must be a PostgreSQL identifier."
  }
}

variable "label_bucket_name" {
  description = "Existing private Label GCS bucket used for PDFs and extracted text."
  type        = string
}

variable "backend_url" {
  description = "Private SILTO backend base URL used by the worker OIDC client."
  type        = string
}

variable "backend_audience" {
  description = "OIDC audience expected by the SILTO backend internal endpoints."
  type        = string
}

variable "backend_service_account_email" {
  description = "SILTO backend service account allowed to invoke direct governance endpoints."
  type        = string
}

variable "backend_service_name" {
  description = "Existing SILTO backend Cloud Run service protected by the catalog-sync OIDC endpoint."
  type        = string
  default     = "silto-gfsi-be"
}

variable "governance_tasks_queue_name" {
  description = "Dedicated Cloud Tasks queue for private source materialization, classification, and RAG work."
  type        = string
  default     = "silto-label-governance"

  validation {
    condition     = can(regex("^[A-Za-z][A-Za-z0-9-]{0,499}$", var.governance_tasks_queue_name))
    error_message = "governance_tasks_queue_name must be a valid Cloud Tasks queue name."
  }
}

variable "governance_tasks_max_dispatches_per_second" {
  description = "Conservative maximum dispatch rate for the private governance queue."
  type        = number
  default     = 1

  validation {
    condition     = var.governance_tasks_max_dispatches_per_second > 0 && var.governance_tasks_max_dispatches_per_second <= 10
    error_message = "governance_tasks_max_dispatches_per_second must be greater than zero and at most 10."
  }
}

variable "governance_tasks_max_concurrent_dispatches" {
  description = "Maximum concurrent private governance jobs; keep low to bound OpenRouter and Chroma load."
  type        = number
  default     = 1

  validation {
    condition     = floor(var.governance_tasks_max_concurrent_dispatches) == var.governance_tasks_max_concurrent_dispatches && var.governance_tasks_max_concurrent_dispatches >= 1 && var.governance_tasks_max_concurrent_dispatches <= 10
    error_message = "governance_tasks_max_concurrent_dispatches must be an integer between 1 and 10."
  }
}

variable "governance_tasks_max_attempts" {
  description = "Maximum task attempts before the durable candidate remains FAILED for explicit ADMIN retry."
  type        = number
  default     = 8

  validation {
    condition     = floor(var.governance_tasks_max_attempts) == var.governance_tasks_max_attempts && var.governance_tasks_max_attempts >= 1 && var.governance_tasks_max_attempts <= 20
    error_message = "governance_tasks_max_attempts must be an integer between 1 and 20."
  }
}

variable "source_discovery_tasks_queue_name" {
  description = "Dedicated Cloud Tasks queue for private official-source discovery proposals."
  type        = string
  default     = "silto-label-source-discovery"

  validation {
    condition     = can(regex("^[A-Za-z][A-Za-z0-9-]{0,499}$", var.source_discovery_tasks_queue_name))
    error_message = "source_discovery_tasks_queue_name must be a valid Cloud Tasks queue name."
  }
}

variable "source_discovery_tasks_max_dispatches_per_second" {
  description = "Maximum source-discovery dispatch rate; keep it low to respect official legislative portals."
  type        = number
  default     = 0.25

  validation {
    condition     = var.source_discovery_tasks_max_dispatches_per_second > 0 && var.source_discovery_tasks_max_dispatches_per_second <= 2
    error_message = "source_discovery_tasks_max_dispatches_per_second must be greater than zero and at most 2."
  }
}

variable "source_discovery_tasks_max_concurrent_dispatches" {
  description = "Maximum concurrent discovery jobs; serialized by default to keep external official portal traffic bounded."
  type        = number
  default     = 1

  validation {
    condition     = floor(var.source_discovery_tasks_max_concurrent_dispatches) == var.source_discovery_tasks_max_concurrent_dispatches && var.source_discovery_tasks_max_concurrent_dispatches >= 1 && var.source_discovery_tasks_max_concurrent_dispatches <= 3
    error_message = "source_discovery_tasks_max_concurrent_dispatches must be an integer between 1 and 3."
  }
}

variable "source_discovery_tasks_max_attempts" {
  description = "Maximum retries for an opaque official-source discovery job before it remains FAILED for explicit ADMIN retry."
  type        = number
  default     = 5

  validation {
    condition     = floor(var.source_discovery_tasks_max_attempts) == var.source_discovery_tasks_max_attempts && var.source_discovery_tasks_max_attempts >= 1 && var.source_discovery_tasks_max_attempts <= 12
    error_message = "source_discovery_tasks_max_attempts must be an integer between 1 and 12."
  }
}

variable "catalog_sync_enabled" {
  description = "Request unpausing the monthly catalog sync after the first curated batch has been reviewed. This alone never unpauses the job."
  type        = bool
  default     = false
}

variable "catalog_sync_backend_flag_confirmed" {
  description = "Set true only after the deployed backend has LABEL_GOVERNANCE_IMPORT_ENABLED=true and LABEL_REGULATORY_CATALOG_SYNC_ENABLED=true, with its OIDC audience and scheduler identity verified."
  type        = bool
  default     = false
}

variable "catalog_sync_actor_confirmed" {
  description = "Set true only after LABEL_CATALOG_SYNC_ACTOR_USER_ID identifies a dedicated non-human governance actor and its audit treatment has been reviewed."
  type        = bool
  default     = false
}

variable "catalog_sync_schedule" {
  description = "Unix-cron schedule for the curated regulatory catalog observation job."
  type        = string
  default     = "0 3 1 * *"
}

variable "catalog_sync_time_zone" {
  description = "IANA timezone used to interpret catalog_sync_schedule."
  type        = string
  default     = "Europe/Rome"
}

variable "allowed_pdf_hosts" {
  description = "Comma-separated additions to the shared official-source host allowlist."
  type        = string
  default     = ""
}

variable "max_instance_count" {
  description = "Maximum private worker instances."
  type        = number
  default     = 3
}

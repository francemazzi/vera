output "service_uri" {
  description = "Private Cloud Run URI; backend and Cloud Tasks use it as OIDC audience/target."
  # `uri` can remain empty in the Terraform provider state after a failed
  # first revision is recovered in-place. The generated Cloud Run default URL
  # is deterministic for this project, service and region and is also the
  # audience configured in the running service.
  value = local.service_audience
}

output "governance_service_account_email" {
  description = "Runtime identity with private bucket and Secret Manager access only."
  value       = google_service_account.governance.email
}

output "governance_artifact_repository" {
  description = "Artifact Registry repository that must contain the reviewed, digest-pinned governance image."
  value       = google_artifact_registry_repository.governance.name
}

output "governance_tasks_queue_name" {
  description = "Dedicated queue to configure as LABEL_GOVERNANCE_TASKS_QUEUE in the SILTO backend."
  value       = google_cloud_tasks_queue.governance.name
}

output "source_discovery_tasks_queue_name" {
  description = "Dedicated queue to configure as LABEL_SOURCE_DISCOVERY_TASKS_QUEUE in the SILTO backend."
  value       = google_cloud_tasks_queue.source_discovery.name
}

output "governance_tasks_invoker_service_account_email" {
  description = "Dedicated OIDC identity used by Cloud Tasks to invoke the internal governance worker."
  value       = google_service_account.governance_tasks.email
}

output "catalog_sync_service_account_email" {
  description = "OIDC identity that the SILTO backend must allow for the private monthly catalog-sync endpoint."
  value       = google_service_account.catalog_sync.email
}

output "catalog_sync_release_gates_satisfied" {
  description = "Whether all Terraform-side catalog-sync release acknowledgements are true. The backend runtime feature flags remain an independent required gate."
  value       = local.catalog_sync_ready
}

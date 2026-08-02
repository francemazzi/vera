output "artifact_registry_repository" {
  description = "Artifact Registry repository for reviewed Chroma images."
  value       = google_artifact_registry_repository.chroma.name
}

output "chroma_private_ip" {
  description = "Private-only Chroma address. Do not expose this address to browsers or public DNS."
  value       = google_compute_instance.chroma.network_interface[0].network_ip
}

output "chroma_endpoint" {
  description = "Backend-only Chroma endpoint for the private governance service."
  value       = "http://${google_compute_instance.chroma.network_interface[0].network_ip}:8000"
}

output "serverless_vpc_connector" {
  description = "Use this connector on the private governance Cloud Run service."
  value       = google_vpc_access_connector.chroma.id
}

output "vpc_network" {
  description = "Private VPC that backend callers must use with all-traffic VPC egress to reach the internal governance service."
  value       = google_compute_network.chroma.id
}

output "vpc_subnetwork" {
  description = "Private subnet to attach to backend Direct VPC egress in this region."
  value       = google_compute_subnetwork.chroma.id
}

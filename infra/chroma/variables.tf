variable "project_id" {
  description = "GCP project that owns the private Chroma deployment."
  type        = string
}

variable "region" {
  description = "Region for the VPC, NAT, KMS key ring and Artifact Registry repository."
  type        = string
  default     = "europe-west1"
}

variable "zone" {
  description = "Zone for the single private Chroma VM."
  type        = string
  default     = "europe-west1-b"
}

variable "network_name" {
  description = "Dedicated VPC name; no public ingress is created."
  type        = string
  default     = "silto-chroma-private"
}

variable "subnet_cidr" {
  description = "Primary private subnet for the Chroma VM."
  type        = string
  default     = "10.90.0.0/24"
}

variable "serverless_connector_cidr" {
  description = "Unused /28 range reserved for the Serverless VPC Access connector."
  type        = string
  default     = "10.90.1.0/28"
}

variable "machine_type" {
  description = "Compute Engine machine type for the single-node Chroma server."
  type        = string
  default     = "e2-medium"
}

variable "data_disk_size_gb" {
  description = "CMEK-encrypted pd-balanced data disk size in GiB."
  type        = number
  default     = 50

  validation {
    condition     = var.data_disk_size_gb >= 50
    error_message = "The Chroma data disk must be at least 50 GiB."
  }
}

variable "chroma_image" {
  description = "Pinned, reviewed Chroma image in Artifact Registry (must include @sha256 digest)."
  type        = string

  validation {
    condition = can(
      regex(
        "^[a-z0-9.-]+-docker\\.pkg\\.dev/.+@sha256:[0-9a-f]{64}$",
        var.chroma_image,
      ),
    )
    error_message = "chroma_image must be a digest-pinned Artifact Registry image."
  }
}

variable "snapshot_retention_days" {
  description = "Number of daily CMEK disk snapshots retained by the GCE resource policy."
  type        = number
  default     = 14

  validation {
    condition     = var.snapshot_retention_days >= 7 && var.snapshot_retention_days <= 365
    error_message = "snapshot_retention_days must be between 7 and 365."
  }
}

variable "alert_notification_channels" {
  description = "Required Monitoring notification-channel resource IDs for VM availability, heartbeat, and disk-space alerts."
  type        = list(string)

  validation {
    condition     = length(var.alert_notification_channels) > 0
    error_message = "At least one Monitoring notification channel is required for the private Chroma production alerts."
  }
}

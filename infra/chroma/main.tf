locals {
  required_services = toset([
    "artifactregistry.googleapis.com",
    "cloudkms.googleapis.com",
    "compute.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "vpcaccess.googleapis.com",
  ])
}

resource "google_project_service" "required" {
  for_each           = local.required_services
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_compute_network" "chroma" {
  name                    = var.network_name
  auto_create_subnetworks = false
  depends_on              = [google_project_service.required]
}

resource "google_compute_subnetwork" "chroma" {
  name                     = "${var.network_name}-subnet"
  ip_cidr_range            = var.subnet_cidr
  region                   = var.region
  network                  = google_compute_network.chroma.id
  private_ip_google_access = true
}

resource "google_vpc_access_connector" "chroma" {
  name          = "silto-chroma-connector"
  region        = var.region
  network       = google_compute_network.chroma.name
  ip_cidr_range = var.serverless_connector_cidr
  # The VPC Access API now requires an explicit capacity range. Two e2-micro
  # instances are the platform minimum; the small ceiling keeps the connector
  # bounded while allowing governance job bursts.
  min_instances = 2
  max_instances = 3
}

resource "google_compute_router" "chroma" {
  name    = "silto-chroma-router"
  region  = var.region
  network = google_compute_network.chroma.id
}

resource "google_compute_router_nat" "chroma" {
  name                               = "silto-chroma-nat"
  router                             = google_compute_router.chroma.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

resource "google_compute_firewall" "allow_cloud_run" {
  name          = "silto-chroma-allow-serverless"
  network       = google_compute_network.chroma.name
  direction     = "INGRESS"
  priority      = 1000
  source_ranges = [var.serverless_connector_cidr]
  target_tags   = ["silto-chroma"]

  allow {
    protocol = "tcp"
    ports    = ["8000"]
  }
}

resource "google_artifact_registry_repository" "chroma" {
  project       = var.project_id
  location      = var.region
  repository_id = "silto-chroma"
  description   = "Reviewed, digest-pinned Chroma server images for SILTO Label"
  format        = "DOCKER"

  depends_on = [google_project_service.required["artifactregistry.googleapis.com"]]
}

resource "google_kms_key_ring" "chroma" {
  name     = "silto-chroma"
  location = var.region
}

resource "google_kms_crypto_key" "data_disk" {
  name            = "silto-chroma-data"
  key_ring        = google_kms_key_ring.chroma.id
  rotation_period = "7776000s"
}

resource "google_kms_crypto_key_iam_member" "compute_service_agent" {
  crypto_key_id = google_kms_crypto_key.data_disk.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:service-${data.google_project.current.number}@compute-system.iam.gserviceaccount.com"
}

resource "google_service_account" "chroma_vm" {
  account_id   = "silto-chroma-vm"
  display_name = "SILTO Chroma VM"
}

resource "google_artifact_registry_repository_iam_member" "chroma_vm_artifact_reader" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.chroma.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.chroma_vm.email}"
}

resource "google_project_iam_member" "chroma_vm_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.chroma_vm.email}"
}

resource "google_project_iam_member" "chroma_vm_metric_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.chroma_vm.email}"
}

resource "google_compute_resource_policy" "daily_snapshots" {
  name   = "silto-chroma-daily-snapshots"
  region = var.region

  snapshot_schedule_policy {
    schedule {
      daily_schedule {
        days_in_cycle = 1
        start_time    = "03:00"
      }
    }

    retention_policy {
      max_retention_days    = var.snapshot_retention_days
      on_source_disk_delete = "KEEP_AUTO_SNAPSHOTS"
    }

    snapshot_properties {
      guest_flush       = true
      storage_locations = [var.region]
    }
  }
}

resource "google_compute_disk" "chroma_data" {
  name = "silto-chroma-data"
  type = "pd-balanced"
  zone = var.zone
  size = var.data_disk_size_gb

  disk_encryption_key {
    kms_key_self_link = google_kms_crypto_key.data_disk.id
  }

  depends_on = [google_kms_crypto_key_iam_member.compute_service_agent]
}

resource "google_compute_disk_resource_policy_attachment" "daily_snapshots" {
  name = google_compute_resource_policy.daily_snapshots.name
  disk = google_compute_disk.chroma_data.name
  zone = var.zone
}

resource "google_compute_instance" "chroma" {
  name         = "silto-chroma"
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["silto-chroma"]

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size  = 20
      type  = "pd-balanced"
    }
  }

  attached_disk {
    source      = google_compute_disk.chroma_data.id
    device_name = "silto-chroma-data"
  }

  network_interface {
    subnetwork = google_compute_subnetwork.chroma.id
  }

  service_account {
    email  = google_service_account.chroma_vm.email
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  metadata = {
    block-project-ssh-keys = "true"
    enable-oslogin         = "TRUE"
  }

  metadata_startup_script = templatefile("${path.module}/startup-script.sh.tftpl", {
    artifact_registry_hostname = "${var.region}-docker.pkg.dev"
    chroma_image               = var.chroma_image
    data_disk_name             = google_compute_disk.chroma_data.name
  })

  shielded_instance_config {
    enable_integrity_monitoring = true
    enable_secure_boot          = true
    enable_vtpm                 = true
  }

  depends_on = [
    google_artifact_registry_repository.chroma,
    google_compute_disk_resource_policy_attachment.daily_snapshots,
    google_compute_router_nat.chroma,
    google_artifact_registry_repository_iam_member.chroma_vm_artifact_reader,
    google_project_iam_member.chroma_vm_log_writer,
    google_project_iam_member.chroma_vm_metric_writer,
  ]
}

resource "google_monitoring_alert_policy" "instance_unavailable" {
  display_name          = "SILTO Chroma VM unavailable"
  combiner              = "OR"
  notification_channels = var.alert_notification_channels

  conditions {
    display_name = "GCE instance uptime missing"

    condition_threshold {
      filter          = "metric.type=\"compute.googleapis.com/instance/uptime\" AND resource.type=\"gce_instance\" AND resource.label.\"instance_id\"=\"${google_compute_instance.chroma.instance_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "300s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }

      evaluation_missing_data = "EVALUATION_MISSING_DATA_ACTIVE"
    }
  }
}

resource "google_monitoring_alert_policy" "disk_space" {
  display_name          = "SILTO Chroma data disk space high"
  combiner              = "OR"
  notification_channels = var.alert_notification_channels

  conditions {
    display_name = "Data disk is more than 85 percent full"

    condition_threshold {
      filter          = "metric.type=\"agent.googleapis.com/disk/percent_used\" AND resource.type=\"gce_instance\" AND resource.label.\"instance_id\"=\"${google_compute_instance.chroma.instance_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 85
      duration        = "300s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }
}

resource "google_logging_metric" "chroma_healthcheck_failures" {
  name        = "silto_chroma_healthcheck_failures"
  description = "Counts failed localhost Chroma heartbeat checks from the private VM."
  filter      = "resource.type=\"gce_instance\" AND resource.labels.instance_id=\"${google_compute_instance.chroma.instance_id}\" AND textPayload:\"silto-chroma-healthcheck failed\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "chroma_healthcheck" {
  display_name          = "SILTO Chroma heartbeat unavailable"
  combiner              = "OR"
  notification_channels = var.alert_notification_channels

  conditions {
    display_name = "Local Chroma heartbeat failed"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.chroma_healthcheck_failures.name}\" AND resource.type=\"gce_instance\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
}

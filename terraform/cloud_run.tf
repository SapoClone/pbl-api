locals {
  image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_repo_id}/pbl-api:${var.image_tag}"

  # Shared plain env vars, expressed once and merged with per-service overrides.
  base_env = merge(var.non_secret_env, {
    NODE_ENV = "production"
  })
}

# ---------------------------------------------------------------------------
# API service — public, scale-to-zero (free-tier friendly)
# ---------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "api" {
  name     = var.api_service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.cloud_run_sa.email

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = local.image

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true # CPU only allocated while handling a request => scale-to-zero billing
        startup_cpu_boost = true
      }

      ports {
        container_port = 8080
      }

      dynamic "env" {
        for_each = merge(local.base_env, { MODULES_SET = "api" })
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = google_secret_manager_secret.app_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service_iam_member" "api_public" {
  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# Worker service — background job processor (BullMQ). Not exposed publicly.
# Needs cpu_idle = false + min_instance_count >= 1 so it can keep polling
# Redis between requests — this is NOT free (small always-on cost), unlike
# the API service above.
# ---------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "worker" {
  name     = var.worker_service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    service_account = google_service_account.cloud_run_sa.email

    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    containers {
      image = local.image

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = false # always-allocated CPU so BullMQ keeps processing without an inbound request
      }

      ports {
        container_port = 8080
      }

      dynamic "env" {
        for_each = merge(local.base_env, { MODULES_SET = "background" })
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = google_secret_manager_secret.app_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [google_project_service.apis]
}

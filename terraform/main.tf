locals {
  apis = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each = toset(local.apis)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "images" {
  repository_id = var.artifact_repo_id
  location      = var.region
  format        = "DOCKER"
  description   = "pbl-api container images"

  depends_on = [google_project_service.apis]
}

# Runtime identity for both Cloud Run services — only needs to read secrets.
resource "google_service_account" "cloud_run_sa" {
  account_id   = "pbl-api-run"
  display_name = "pbl-api Cloud Run runtime"

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret" "app_secrets" {
  for_each = toset(var.secret_env_names)

  secret_id = each.value
  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "cloud_run_sa_accessor" {
  for_each = google_secret_manager_secret.app_secrets

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

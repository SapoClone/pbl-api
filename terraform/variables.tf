variable "project_id" {
  description = "GCP project ID. Create one at https://console.cloud.google.com/projectcreate"
  type        = string
}

variable "region" {
  description = "GCP region for all resources. asia-southeast1 (Singapore) is closest to VN."
  type        = string
  default     = "asia-southeast1"
}

variable "github_owner" {
  description = "GitHub org/user that owns the pbl-api repo, e.g. \"my-org\"."
  type        = string
}

variable "github_repo" {
  description = "GitHub repo name, e.g. \"pbl-api\"."
  type        = string
}

variable "artifact_repo_id" {
  description = "Artifact Registry repository id (Docker format)."
  type        = string
  default     = "pbl-api"
}

variable "api_service_name" {
  description = "Cloud Run service name for the public API (MODULES_SET=api)."
  type        = string
  default     = "pbl-api"
}

variable "worker_service_name" {
  description = "Cloud Run service name for the background worker (MODULES_SET=background)."
  type        = string
  default     = "pbl-api-worker"
}

variable "image_tag" {
  description = "Docker image tag to deploy. CI overrides this per-deploy (e.g. the git SHA)."
  type        = string
  default     = "latest"
}

# Non-secret application config. Real values for DATABASE_HOST/REDIS_HOST etc.
# come from your Neon/Upstash dashboards once you provision them there.
variable "non_secret_env" {
  description = "Plain (non-secret) env vars shared by both Cloud Run services."
  type        = map(string)
  default = {
    APP_NAME                            = "pbl-api"
    APP_DEBUG                           = "false"
    API_PREFIX                          = "api"
    APP_FALLBACK_LANGUAGE               = "en"
    APP_LOG_LEVEL                       = "warn"
    APP_LOG_SERVICE                     = "console"
    APP_CORS_ORIGIN                     = "false"
    DATABASE_TYPE                       = "postgres"
    DATABASE_HOST                       = "CHANGE_ME.neon.tech"
    DATABASE_PORT                       = "5432"
    DATABASE_USERNAME                   = "CHANGE_ME"
    DATABASE_NAME                       = "CHANGE_ME"
    DATABASE_LOGGING                    = "false"
    DATABASE_SYNCHRONIZE                = "false"
    DATABASE_MAX_CONNECTIONS            = "10"
    DATABASE_SSL_ENABLED                = "true"
    DATABASE_REJECT_UNAUTHORIZED        = "true"
    REDIS_HOST                          = "CHANGE_ME.upstash.io"
    REDIS_PORT                          = "6379"
    REDIS_TLS_ENABLED                   = "true"
    MAIL_HOST                           = "CHANGE_ME"
    MAIL_PORT                           = "587"
    MAIL_USER                           = "CHANGE_ME"
    MAIL_IGNORE_TLS                     = "false"
    MAIL_SECURE                         = "false"
    MAIL_REQUIRE_TLS                    = "true"
    MAIL_DEFAULT_EMAIL                  = "noreply@example.com"
    MAIL_DEFAULT_NAME                   = "No Reply"
    AUTH_JWT_TOKEN_EXPIRES_IN           = "1d"
    AUTH_REFRESH_TOKEN_EXPIRES_IN       = "365d"
    AUTH_FORGOT_TOKEN_EXPIRES_IN        = "7d"
    AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN = "1d"
  }
}

# Secret Manager only stores the *container* here — Terraform never writes
# the actual secret value (keeps credentials out of state/version control).
# Add real values yourself after apply, e.g.:
#   echo -n "the-real-value" | gcloud secrets versions add DATABASE_PASSWORD --data-file=-
variable "secret_env_names" {
  description = "Env var names backed by Secret Manager (values added out-of-band)."
  type        = list(string)
  default = [
    "DATABASE_PASSWORD",
    "REDIS_PASSWORD",
    "MAIL_PASSWORD",
    "OBSERVE_APP_KEY",
    "OBSERVE_APP_SECRET",
    "AUTH_JWT_SECRET",
    "AUTH_REFRESH_SECRET",
    "AUTH_FORGOT_SECRET",
    "AUTH_CONFIRM_EMAIL_SECRET",
  ]
}

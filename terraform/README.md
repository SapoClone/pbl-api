# Deploying pbl-api to Cloud Run (free-tier design)

Architecture: two Cloud Run v2 services built from the same image, switched by
`MODULES_SET`:

- **`pbl-api`** — public HTTP API, `min_instance_count = 0` (scales to zero,
  free-tier eligible).
- **`pbl-api-worker`** — BullMQ background processor, `min_instance_count = 1`
  with `cpu_idle = false` (CPU always allocated) so it can keep polling Redis
  between requests. This is **not free** — it's a small always-on cost
  (roughly one always-on 1 vCPU / 512Mi instance, a few $/month). If you don't
  need background jobs running yet, skip deploying this service and only
  apply the `google_cloud_run_v2_service.api` resource.

Database: **Neon** (serverless Postgres, scales to zero). Cache/queue:
**Upstash** (serverless Redis, TLS). CI/CD: **GitHub Actions**, authenticating
to GCP via Workload Identity Federation (no long-lived JSON key).

## 1. Provision Neon

1. Create a project at neon.tech (free tier: 500MB, autosuspends when idle).
2. From the connection details, note: host, database name, username, password.
   Neon requires TLS — that's already handled by
   `DATABASE_SSL_ENABLED=true` / `DATABASE_REJECT_UNAUTHORIZED=true` below.

## 2. Provision Upstash

1. Create a Redis database at upstash.com (free tier: 256MB, TLS).
2. Use the **TCP** connection details (host/port/password), not the REST API
   — this app talks to Redis via `ioredis`/BullMQ, not Upstash's REST
   protocol.

## 3. Create the GCP project

```bash
gcloud auth login
gcloud projects create pbl-api-<something-unique>
gcloud config set project pbl-api-<something-unique>
# Link a billing account (required even for free-tier usage):
gcloud billing projects link pbl-api-<something-unique> --billing-account=<BILLING_ACCOUNT_ID>
```

## 4. Apply Terraform

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: project_id, github_owner, github_repo,
# and non_secret_env (DATABASE_HOST/USERNAME/NAME, REDIS_HOST from steps 1-2)

terraform init
terraform apply
```

This creates: Artifact Registry repo, both Cloud Run services, the runtime +
deployer service accounts, Workload Identity Federation trust scoped to your
GitHub repo, and empty Secret Manager containers for every secret env var.

## 5. Fill in the real secrets

Terraform deliberately never writes secret values (keeps them out of state
and version control). Add each one now:

```bash
echo -n "<neon-password>"                | gcloud secrets versions add DATABASE_PASSWORD --data-file=-
echo -n "<upstash-password>"             | gcloud secrets versions add REDIS_PASSWORD --data-file=-
echo -n "<smtp-password>"                | gcloud secrets versions add MAIL_PASSWORD --data-file=-
echo -n "<observe.nestjs.com app key>"   | gcloud secrets versions add OBSERVE_APP_KEY --data-file=-
echo -n "<observe.nestjs.com app secret>" | gcloud secrets versions add OBSERVE_APP_SECRET --data-file=-
openssl rand -base64 32 | tr -d '\n'     | gcloud secrets versions add AUTH_JWT_SECRET --data-file=-
openssl rand -base64 32 | tr -d '\n'     | gcloud secrets versions add AUTH_REFRESH_SECRET --data-file=-
openssl rand -base64 32 | tr -d '\n'     | gcloud secrets versions add AUTH_FORGOT_SECRET --data-file=-
openssl rand -base64 32 | tr -d '\n'     | gcloud secrets versions add AUTH_CONFIRM_EMAIL_SECRET --data-file=-
```

Cloud Run always reads the `latest` version, so re-running
`gcloud secrets versions add` and redeploying is how you rotate a secret.

## 6. Run the initial migration against Neon

`DATABASE_SYNCHRONIZE=false` in production, so the schema has to come from
migrations, run once from your machine (or a one-off CI job) with Neon's
credentials in a local `.env`:

```bash
pnpm migration:up
```

## 7. Wire up GitHub Actions

`terraform apply` printed `workload_identity_provider` and
`deployer_service_account_email` — copy those. In the GitHub repo, go to
**Settings → Secrets and variables → Actions → Variables** and add:

| Variable | Value |
|---|---|
| `GCP_PROJECT_ID` | your project id |
| `GCP_REGION` | `asia-southeast1` (or whatever you set) |
| `GCP_ARTIFACT_REPO` | `pbl-api` (or your `artifact_repo_id`) |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | terraform output `workload_identity_provider` |
| `GCP_DEPLOYER_SA_EMAIL` | terraform output `deployer_service_account_email` |
| `GCP_API_SERVICE_NAME` | `pbl-api` |
| `GCP_WORKER_SERVICE_NAME` | `pbl-api-worker` |

Also create a GitHub **environment** named `production` (Settings →
Environments) — `.github/workflows/deploy.yml`'s deploy job targets it, so
you can optionally require manual approval there before every deploy.

Push to `main` and `.github/workflows/deploy.yml` builds the image, pushes it
to Artifact Registry, and updates both Cloud Run services (image only — env
vars/secrets/scaling stay whatever Terraform set, so `terraform apply` is
still how you change those).

## Notes / things to revisit later

- **State is local** (`versions.tf` uses the default local backend) since no
  GCP project existed when this was written. Once you have one, create a GCS
  bucket and uncomment the `backend "gcs"` block, then
  `terraform init -migrate-state`.
- **Cost isn't actually zero** if you deploy the worker service — see the
  architecture note at the top. If background jobs aren't needed yet, comment
  out or don't apply `google_cloud_run_v2_service.worker` and its IAM/env
  wiring.
- Cold starts: the API service scaling to zero means the first request after
  idle pays a cold-start cost (container boot + Neon autoresume). Acceptable
  for a side project, not for something latency-sensitive.

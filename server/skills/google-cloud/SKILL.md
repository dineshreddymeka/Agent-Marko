---
name: google-cloud
description: Operate Google Cloud Platform (GCP) — gcloud CLI, Compute Engine, Cloud Storage, BigQuery, IAM, Cloud Run, and Cloud Functions with safe auth and project scoping.
triggers: ["gcp", "google cloud", "gcloud", "compute engine", "gce", "cloud storage", "gcs bucket", "bigquery", "bq query", "cloud run", "cloud functions", "service account", "workload identity", "cloud iam", "google cloud platform"]
---

# Google Cloud Platform (GCP)

Use this skill when the user asks to **provision, inspect, debug, or automate GCP resources** — VMs, buckets, datasets, IAM, serverless, or networking. Prefer **`gcloud`** for interactive ops and **Infrastructure as Code** (Terraform, Deployment Manager, or Cloud Foundation Toolkit) for durable changes.

## Auth and project context

**Interactive (human or dev machine):**
```bash
gcloud auth login                    # user credentials
gcloud auth application-default login  # ADC for SDKs / Terraform
gcloud config set project PROJECT_ID
gcloud config set compute/region us-central1
```

**Automation (CI / servers):**
- Use a **service account** JSON key or **Workload Identity Federation** (preferred on GKE / GitHub Actions) — never commit keys.
- Set `GOOGLE_APPLICATION_CREDENTIALS` to the key path, or rely on ADC on GCE/GKE/Cloud Run metadata.
- Scope every command: `--project=PROJECT_ID` and confirm with `gcloud config get-value project`.

**Verify identity:**
```bash
gcloud auth list
gcloud config list
gcloud projects describe PROJECT_ID
```

## IAM and safety

- Principle of least privilege: grant roles at the **narrowest scope** (resource > project > org).
- Prefer **custom roles** or predefined roles (`roles/storage.objectViewer`) over `roles/owner`.
- Service accounts: one workload = one SA; use `gcloud iam service-accounts create` + `gcloud projects add-iam-policy-binding`.
- For cross-project access, use **conditional IAM** or **VPC Service Controls** when handling sensitive data.
- **Never** paste SA private keys into chat or commit them; rotate if exposed.

## Common CLI patterns

### Compute Engine
```bash
gcloud compute instances list
gcloud compute instances describe INSTANCE --zone=ZONE
gcloud compute ssh INSTANCE --zone=ZONE
gcloud compute instances create NAME --zone=ZONE --machine-type=e2-medium --image-family=debian-12 --image-project=debian-cloud
```

### Cloud Storage (GCS)
```bash
gsutil ls gs://BUCKET/
gsutil cp LOCAL gs://BUCKET/path/
gsutil iam get gs://BUCKET
gcloud storage buckets describe gs://BUCKET   # newer unified CLI
```

### BigQuery
```bash
bq ls
bq query --use_legacy_sql=false 'SELECT 1'
bq show DATASET.TABLE
bq mk --dataset PROJECT:DATASET
```

### Cloud Run / Cloud Functions
```bash
gcloud run services list --region=REGION
gcloud run deploy SERVICE --source . --region=REGION --allow-unauthenticated   # only if intended
gcloud functions list --gen2
```

### Logging and debugging
```bash
gcloud logging read 'resource.type="cloud_run_revision"' --limit=50 --format=json
gcloud services list --enabled
```

## API and SDK notes

- REST base: `https://cloud.googleapis.com/` (most services) or service-specific hosts (`bigquery.googleapis.com`).
- Client libraries: `@google-cloud/*` (Node), `google-cloud-*` (Python), `cloud.google.com/go/*` (Go).
- Always pass **project ID** explicitly in SDK calls; distinguish **project ID** vs **project number**.

## Infrastructure as Code

- **Terraform**: `google` provider; store state in a GCS bucket with versioning + locking.
- **Cloud Deployment Manager**: YAML/Jinja templates (legacy but still in use).
- **Config Connector / Anthos**: Kubernetes CRDs for GCP resources.

Before `apply`, run a plan and review IAM bindings, public exposure (`--allow-unauthenticated`, bucket ACLs), and region choices.

## Troubleshooting checklist

1. Wrong project? `gcloud config get-value project`
2. API disabled? `gcloud services enable SERVICE.googleapis.com`
3. Permission denied? `gcloud projects get-iam-policy PROJECT --flatten="bindings[].members" --filter="bindings.members:USER"`
4. Quota? Cloud Console → IAM & Admin → Quotas, or `gcloud compute project-info describe`

## When to split work

- **Google Workspace** (Gmail, Drive, Calendar admin APIs) → use the `google-workspace` skill; it uses different OAuth scopes and the Admin SDK / Workspace APIs, not core GCP IAM alone.

## References

- gcloud CLI: https://cloud.google.com/sdk/gcloud
- IAM overview: https://cloud.google.com/iam/docs
- BigQuery: https://cloud.google.com/bigquery/docs
- Cloud Storage: https://cloud.google.com/storage/docs

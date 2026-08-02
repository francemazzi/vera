# Private `silto-vera-governance` Cloud Run service

This stack deploys the source-governance worker as an internal-only Cloud Run service. It is
intentionally separate from the Label analysis runner: Cloud Tasks invokes `/internal/source-jobs`
and `/internal/source-discovery-jobs`, while the SILTO backend uses IAM/OIDC for direct internal
operations. No browser obtains a VERA, Chroma, GCS, or OpenRouter endpoint.

## Security boundary

- ingress remains `INTERNAL_ONLY`; Terraform creates no public invoker binding;
- only the backend service account and a Terraform-managed Cloud Tasks OIDC service account receive
  `roles/run.invoker`;
- the backend can enqueue only into the dedicated governance and source-discovery queues; the
  Google-managed Cloud Tasks service agent mints its dispatch token, and no broad Cloud Tasks role
  is granted;
- the runtime service account has private-bucket object read/create access and Secret Manager access
  only to the configured OpenRouter, VERA database, and optional Chroma-proxy secrets;
- VPC egress is `ALL_TRAFFIC` through the Serverless VPC connector from `infra/chroma`, so the
  private Chroma IP is reachable and OpenRouter egress uses Cloud NAT;
- the Cloud Run service robot has Artifact Registry reader access only on the governance repository.
  The explicitly configured Cloud Build execution account has writer access only on that repository;
- `CHROMA_ENDPOINT` is a non-secret private configuration value; API keys are injected solely from
  Secret Manager and must never be logged or returned.

Application authorization is narrower than Cloud Run IAM: the Cloud Tasks identity can call only
`/internal/source-jobs` and `/internal/source-discovery-jobs`; `/internal/source-versions` and
direct classification require the backend service-account OIDC token. A discovery task contains only
a `discoveryRunId`; LangGraph invokes only backend-configured official-authority endpoints,
snapshots candidates in private GCS, and returns staging proposals. It cannot create a ledger
version or access Chroma. The ledger actor is the ADMIN identity forwarded in the authenticated
backend payload, not a browser header.

## Required private networking for the SILTO backend

An `INTERNAL_ONLY` Cloud Run target is reachable from another Cloud Run service only when the
calling service sends all egress through a VPC path. Before enabling worker dispatch, update the
existing `silto-gfsi-be` deployment to use the VPC and subnet created by `../chroma` (or express the
equivalent in the backend's own deployment definition):

```bash
gcloud run services update silto-gfsi-be \
  --project=siltopro \
  --region=europe-west1 \
  --network=silto-chroma-private \
  --subnet=silto-chroma-private-subnet \
  --vpc-egress=all-traffic
```

Use the corresponding project, region, VPC, and subnet outputs in each environment. Do not make the
governance service public as a workaround. After the backend rollout, verify its VPC egress
configuration and make a signed backend-to-governance health request; the browser must still receive
neither a governance nor a Chroma URL.

## One-time image repository bootstrap

The first normal apply needs a digest-pinned governance image, while the image repository is created
by this module. Bootstrap that intentional dependency in two stages. This is the only approved use
of targeted Terraform applies here.

1. Copy `governance.tfvars.example` to `governance.tfvars`, set deployment identities and a
   syntactically valid temporary digest in `image`. Never use that temporary digest in a normal
   apply.
2. Create only the repository and its least-privilege IAM bindings:

   ```bash
   terraform -chdir=infra/governance init
   terraform -chdir=infra/governance apply \
     -var-file=governance.tfvars \
     -target=google_artifact_registry_repository.governance \
     -target=google_artifact_registry_repository_iam_member.cloud_build_writer \
     -target=google_artifact_registry_repository_iam_member.cloud_run_reader
   ```

3. Build with the configured Cloud Build execution account and a unique, reviewable tag. From the
   VERA repository root:

   ```bash
   IMAGE_TAG="europe-west1-docker.pkg.dev/siltopro/silto-governance/silto-vera-governance:REVIEWED_BUILD_ID"
   gcloud builds submit --config=cloudbuild.label-governance.yaml \
     --substitutions=_IMAGE="$IMAGE_TAG"
   gcloud artifacts docker images describe "$IMAGE_TAG" \
     --format='value(image_summary.digest)'
   ```

4. Replace `image` with the resulting full `@sha256:` reference, review the plan, then run the
   normal approved Terraform apply. Mutable tags must never be supplied to this module.

If the repository was created outside this module previously, import it and its IAM bindings into
Terraform state before the normal apply instead of creating a second repository or granting
project-wide Artifact Registry roles.

## Deploy configuration and queue hand-off

Copy `governance.tfvars.example` to `governance.tfvars`. Secrets stay in Secret Manager, never in
this file. The module creates a conservative queue with one active task and one dispatch per second
by default; increase limits only after observing bounded OpenRouter and Chroma load.

```bash
terraform -chdir=infra/governance fmt -check
terraform -chdir=infra/governance validate
terraform -chdir=infra/governance plan -var-file=governance.tfvars
```

After the normal approved apply, configure the SILTO backend with these output values, then deploy
the backend through its own workflow:

```text
LABEL_GOVERNANCE_TASKS_ENABLED=true
LABEL_GOVERNANCE_TASKS_LOCATION=europe-west1
LABEL_GOVERNANCE_TASKS_QUEUE=<governance_tasks_queue_name>
LABEL_GOVERNANCE_WORKER_URL=<service_uri>
LABEL_GOVERNANCE_WORKER_AUDIENCE=<service_uri>
LABEL_GOVERNANCE_TASKS_INVOKER_SERVICE_ACCOUNT_EMAIL=<governance_tasks_invoker_service_account_email>
LABEL_SOURCE_DISCOVERY_TASKS_QUEUE=<source_discovery_tasks_queue_name>
LABEL_SOURCE_DISCOVERY_WORKER_URL=<service_uri>
LABEL_SOURCE_DISCOVERY_WORKER_AUDIENCE=<service_uri>
```

The backend runtime service account receives queue-level `roles/cloudtasks.enqueuer`, not a
project-wide role. The service URI and its OIDC audience are the deterministic `run.app` URL output
by this module, not a manually guessed `a.run.app` host.

The source-discovery queue defaults to one concurrent task and 0.25 task/s, independently of the
classification/indexing queue. Keep country discovery disabled in the backend feature flag until its
`OfficialAuthorityProfile` has an allowlisted official search endpoint and an observed smoke result.
An empty profile set is a completed zero-proposal run, not permission to use a generic web search
engine.

## Database migration boundary

When this service shares the SILTO PostgreSQL database, do **not** run the VERA storage migrations
against `public`: both Prisma projects would otherwise use the same `_prisma_migrations` ledger. Run
the VERA migration with the direct database secret and `VERA_DATABASE_SCHEMA=vera` before deploying
the service. The storage Prisma config adds the schema URL parameter without printing the connection
string; `GOVERNANCE_DATABASE_SCHEMA` is set by this module for the runtime client.

```bash
DATABASE_URL="$(gcloud secrets versions access latest \
  --project=siltopro --secret=silto-label-direct-url)" \
VERA_DATABASE_SCHEMA=vera \
pnpm --filter @vera/storage migrate:deploy
```

Afterwards, `prisma migrate status` with the same two environment variables must report only the
VERA migrations as applied. SILTO's Prisma deploy continues to run separately with its own `public`
schema URL.

Configure the SILTO backend callback verifier to trust the `governance_service_account_email` output
for its worker-only endpoints. This permits the worker to read, claim, and callback source jobs with
OIDC without granting it any browser-facing access.

## Monthly regulatory catalog observation

The module provisions a dedicated Cloud Scheduler identity and a monthly job, paused by default. It
calls only `POST /internal/label/sources/catalog/sync` with an OIDC token; it cannot access the
browser API, VERA, Chroma, or source bodies.

Before setting any Terraform release acknowledgement to `true`, the deployed backend must have all
of the following configuration reviewed:

```text
LABEL_GOVERNANCE_IMPORT_ENABLED=true
LABEL_REGULATORY_CATALOG_SYNC_ENABLED=true
LABEL_REGULATORY_CATALOG_SYNC_AUDIENCE=<backend deterministic Cloud Run URL>
LABEL_REGULATORY_CATALOG_SYNC_SERVICE_ACCOUNT_EMAIL=<catalog_sync_service_account_email>
LABEL_CATALOG_SYNC_ACTOR_USER_ID=<dedicated non-human governance actor>
```

The actor must not be a person's account. With the current authorization model, it must be a
dedicated system-owned ADMIN record with explicitly reviewed audit ownership; a future `SYNC_AGENT`
role should replace that exception when available.

The scheduler unpauses only when all three Terraform acknowledgements are true:
`catalog_sync_enabled`, `catalog_sync_backend_flag_confirmed`, and `catalog_sync_actor_confirmed`.
The backend feature flags remain an independent gate. The scheduler has a 300-second hard deadline
and no automatic retry to avoid overlapping long synchronous fetches. Keep it paused until a
measured controlled run completes safely within that bound or the backend work is made asynchronous
and idempotently bounded.

Each successful observation may create only a new `UNVERIFIED` candidate. It must never approve a
source, overwrite a prior version, or activate a formal rule pack.

# Private Chroma on GCP

This Terraform stack provisions a **single private Chroma server** for SILTO Label. It is
intentionally not a public web service and must only be called by the private VERA governance
service.

## What it creates

- an `e2-medium` VM in `europe-west1-b`, with no public IP;
- a dedicated VPC, private subnet, Serverless VPC Access connector and Cloud NAT;
- TCP/8000 ingress only from the connector range used by Cloud Run;
- a CMEK-encrypted 50 GiB `pd-balanced` Chroma data disk, daily snapshots and configurable
  retention;
- a minimal VM service account, Artifact Registry repository, Cloud Logging/Monitoring permissions,
  and repository-scoped image reader access;
- VM availability, periodic localhost Chroma-heartbeat, and data-disk space alert policies with at
  least one required notification channel.

Chroma has no browser-facing route. The Cloud Run governance service uses the
`serverless_vpc_connector` output and the private `chroma_endpoint` output. The SILTO backend calls
the governance service over IAM/OIDC; it never connects to Chroma directly.

## One-time image bootstrap

A full apply needs a digest-pinned Chroma image, while the target Artifact Registry repository is
created by this module. Use this two-stage bootstrap once; it avoids starting a VM before its
private image is available.

1. Copy `chroma.tfvars.example` to `chroma.tfvars`, set a real Monitoring notification channel, and
   give `chroma_image` a syntactically valid temporary digest. Do not run a normal apply with that
   temporary value.
2. Create only the Artifact Registry repository:

   ```bash
   terraform -chdir=infra/chroma init
   terraform -chdir=infra/chroma apply \
     -var-file=chroma.tfvars \
     -target=google_artifact_registry_repository.chroma
   ```

3. Mirror a reviewed Chroma release into the private repository, scan it under the approved image
   process, and resolve the digest **from the target repository**:

   ```bash
   gcloud auth configure-docker europe-west1-docker.pkg.dev
   docker pull chromadb/chroma:REVIEWED_VERSION
   docker tag chromadb/chroma:REVIEWED_VERSION \
     europe-west1-docker.pkg.dev/siltopro/silto-chroma/chroma:REVIEWED_VERSION
   docker push europe-west1-docker.pkg.dev/siltopro/silto-chroma/chroma:REVIEWED_VERSION
   gcloud artifacts docker images describe \
     europe-west1-docker.pkg.dev/siltopro/silto-chroma/chroma:REVIEWED_VERSION \
     --format='value(image_summary.digest)'
   ```

4. Replace `chroma_image` with the resulting target `europe-west1-docker.pkg.dev/...@sha256:...`
   reference, review the normal plan, then apply through the approved infrastructure workflow. Never
   use a mutable tag in `chroma_image`.

If the repository already exists, import it into Terraform state instead of creating a duplicate.
The VM service account intentionally receives Artifact Registry reader only on this repository, not
at project scope.

## Before a normal apply

1. Authenticate Terraform with a deployment service account that can create the listed resources.
2. Copy `chroma.tfvars.example` to `chroma.tfvars` and set the actual project ID, image digest, and
   Monitoring notification channel IDs.
3. Review the dedicated VPC CIDRs for conflicts with existing private networks.
4. Review the plan and apply only through the approved infrastructure workflow.

```bash
terraform -chdir=infra/chroma fmt -check
terraform -chdir=infra/chroma validate
terraform -chdir=infra/chroma plan -var-file=chroma.tfvars
```

The module follows Chroma's GCP single-node deployment shape, but strengthens it with private
networking, CMEK, snapshots and a serverless connector. Chroma is explicitly started with
`IS_PERSISTENT=TRUE` and `PERSIST_DIRECTORY=/data`, which is the mounted persistent disk; reset is
disabled. A systemd health check calls the local `/api/v2/heartbeat` endpoint after startup and
every minute, restarting the service on failure and emitting an alertable Cloud Logging metric.

## Private verification and recovery

- Test Chroma heartbeat, collection upsert, and metadata-filtered query only from a workload
  attached to this VPC (normally the governance Cloud Run service). Do not open TCP/8000, add a
  public IP, or test from a browser.
- Verify that governance Cloud Run uses the `serverless_vpc_connector` output with all egress routed
  through it.
- Confirm each alert policy has a working notification channel before accepting the deployment.
- Perform a documented restore drill from a daily data-disk snapshot in an isolated private test VM
  before relying on the service for formal authoring. Restore validation must include a Chroma
  heartbeat and a metadata-filtered query, not merely successful disk attachment.

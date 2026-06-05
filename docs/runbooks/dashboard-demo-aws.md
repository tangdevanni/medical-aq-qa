# Dashboard AWS Deployment

This runbook deploys the dashboard as a direct QA login application. QA users do not use Playwright to access the dashboard. Playwright remains a backend-only portal collection dependency for workbook, OASIS, referral, and billing-period evidence.

## Target Architecture

- `apps/dashboard`: Next.js UI exposed through a public Application Load Balancer.
- `services/api`: Fastify control-plane API for agency queues, batch orchestration, and patient artifacts.
- `Amazon ECS on Fargate`: separate `dashboard` and `api` services.
- `Application Load Balancer`: default rule routes `/` to dashboard; `/api/*` routes to API.
- `Amazon ECR`: stores dashboard and API images.
- `AWS Secrets Manager`: stores dashboard auth config, portal credentials, LLM credentials, and OCR credentials.
- `Amazon EFS`: mounted into the API service at `/data/control-plane` so agency runs and patient artifacts survive task restarts.
- `Amazon CloudWatch Logs`: container logs plus optional dashboard auth audit events.

## Dashboard Login Setup

Generate QA users from the repo root:

```powershell
cmd /c pnpm dashboard:qa-user -- --email qa.user@example.com --name "QA User" --agencies active-home-health,star-home-health
```

Combine generated user objects into one JSON array and store it as `DASHBOARD_QA_USERS_JSON`. See `docs/runbooks/dashboard-login-accounts.md`.

Create dashboard secrets:

```bash
aws secretsmanager create-secret \
  --name medical-ai-qa/dashboard-session-secret \
  --secret-string "replace-with-at-least-32-random-characters" \
  --region "$AWS_REGION"

aws secretsmanager create-secret \
  --name medical-ai-qa/dashboard-qa-users-json \
  --secret-string file://dashboard-qa-users.json \
  --region "$AWS_REGION"
```

Production dashboard auth requires:

- `DASHBOARD_SESSION_SECRET` from Secrets Manager.
- `DASHBOARD_QA_USERS_JSON` from Secrets Manager.
- `DASHBOARD_ALLOW_PLAINTEXT_PASSWORDS=false`.
- User entries with `passwordHash`, not plaintext `password`.

## Runtime Environment

Dashboard container:

- `NEXT_PUBLIC_API_BASE_URL=http://medical-ai-qa-prod-alb-925770298.us-east-2.elb.amazonaws.com/api`
- `DASHBOARD_PUBLIC_BASE_URL=http://medical-ai-qa-prod-alb-925770298.us-east-2.elb.amazonaws.com`
- `DASHBOARD_BACKEND_FETCH_TIMEOUT_MS=25000`
- `DASHBOARD_SESSION_TTL_HOURS=12`
- `DASHBOARD_ALLOW_PLAINTEXT_PASSWORDS=false`
- `DASHBOARD_SESSION_SECRET` from Secrets Manager
- `DASHBOARD_QA_USERS_JSON` from Secrets Manager
- Optional audit logging:
  - `DASHBOARD_AUTH_AUDIT_LOG_GROUP=/medical-ai-qa/dashboard-auth`
  - `DASHBOARD_AUTH_AUDIT_AWS_REGION=<REGION>`

API container:

- `API_PORT=3000`
- `API_HOST=0.0.0.0` for container binding only. Users and redirects should never see `0.0.0.0`.
- `API_REQUEST_TIMEOUT_MS=120000`
- `API_STORAGE_ROOT=/data/control-plane`
- `API_LOG_LEVEL=info`
- `API_AUTONOMOUS_MODE=manual_only` for production initialization; switch to `full` only when scheduled autonomous runs are approved.
- `PATIENT_MEMORY_WRITE_ENABLED=true`
- `DELTA_REUSE_ENABLED=true`
- `API_ENABLE_VERIFICATION_ROUTES=false`
- `API_CORS_ORIGIN=http://medical-ai-qa-prod-alb-925770298.us-east-2.elb.amazonaws.com`
- `OASIS_WRITE_ENABLED=false` for read-only QA deployment
- `FINALE_PATIENT_CONCURRENCY=1` for the first live rollout
- `AUTONOMOUS_AGENCY_IDS=star-home-health` for the first backend canary; expand after Star Home passes
- `DEFAULT_SUBSIDIARY_RERUN_ENABLED=false` during initialization; enable after controlled Star Home validation
- `DEFAULT_SUBSIDIARY_RERUN_INTERVAL_HOURS=24`
- `DEFAULT_SUBSIDIARY_RERUN_LOCAL_TIMES=20:30` for one production autonomous window per day in Asia/Manila
- `PORTAL_HEADLESS=true`
- `CODE_LLM_ENABLED=true`
- `LLM_PROVIDER=bedrock`
- `BEDROCK_REGION=<BEDROCK_REGION>`
- `BEDROCK_MODEL_ID=amazon.nova-pro-v1:0`
- `TEXTRACT_S3_REGION=<TEXTRACT_S3_REGION>`
- `TEXTRACT_S3_BUCKET=<TEXTRACT_S3_BUCKET>`
- `TEXTRACT_S3_PREFIX=finale-workbook-intake/textract`

Store portal, Bedrock, Textract, and any other backend automation secrets in Secrets Manager and inject them into the API task definition. Dashboard users do not need those portal credentials.
Nova Pro is the recommended default operational model for the current Bedrock-only intake pipeline. Referral proposal and referral QA may still fall back even on Pro until their prompt/parse hardening is completed.
Before building the API image, generate the normalized POC runtime asset:

```powershell
pnpm --dir services/finale-workbook-intake poc:normalize-question-bank
```

The API Dockerfile now fails the build if `services/finale-workbook-intake/assets/poc-question-bank/poc-question-bank.normalized.v1.json` is missing.
The API seeds subsidiary metadata into `API_STORAGE_ROOT` on startup, so the mounted volume is the runtime source of truth; the image should not be treated as the place where agency state lives.
For the production starting point, keep `API_AUTONOMOUS_MODE=manual_only`. This lets the dashboard load current memory-backed content and prevents startup from scraping the agency fleet. Operators can then run a memory migration, a dashboard reproject, or a one-patient bot run from the terminal when ready.
`FINALE_PATIENT_CONCURRENCY` is consumed by the intake runner, not the dashboard. Keep it at `1` for initial production validation. Raise it only after controlled Star Home concurrency tests show no portal/session contention and the API task has enough CPU and memory headroom.

## 504 Prevention

Long-running trigger routes must acknowledge quickly and let the dashboard poll persisted status:

- `POST /api/agencies/{agencyId}/refresh`
- `POST /api/runs/upload`
- `POST /api/runs/{batchId}/start`
- `POST /api/runs/{batchId}/sample`
- retry routes

These routes should return `202` with a compact `{ batchId, status, refreshAcceptedAt, statusUrl }` response. They must not build full dashboard run detail before responding. Workbook acquisition, parsing, patient processing, and dashboard-state writing continue in the API process through `activeBatchJobs`, with EFS-backed control-plane JSON as the durable status source.

`DASHBOARD_BACKEND_FETCH_TIMEOUT_MS` prevents a dashboard server request from hanging until the browser or ALB times out. `API_REQUEST_TIMEOUT_MS` gives the API room for non-trigger reads, but trigger routes should normally complete in under two seconds. The ALB idle timeout may be raised to `120-300` seconds for operational breathing room, but it is not the primary 504 fix.

## Demo / Staging Mode

Use the same API and dashboard images for a pre-production demo, but run the API in manual-only mode:

- `API_AUTONOMOUS_MODE=manual_only`
- `API_ENABLE_VERIFICATION_ROUTES=true`
- `DEFAULT_SUBSIDIARY_RERUN_ENABLED=false`
- `FINALE_PATIENT_CONCURRENCY=1`

This keeps agency refreshes manual, reduces token burn, and gives you a stable demo path for:
- OASIS gate behavior
- `AI Plan of Care` rendering
- Nova Pro patient artifacts and LLM audit verification

For demo/staging, seed only a small known patient set or a single controlled manual refresh. Do not enable the full autonomous agency fleet until the demo is signed off.

Run the same Playwright verification harness against staging by setting:

- `PLAYWRIGHT_BASE_URL=https://YOUR_STAGING_DASHBOARD_DNS`
- `PLAYWRIGHT_API_BASE_URL=https://YOUR_STAGING_API_DNS`
- `PLAYWRIGHT_DASHBOARD_EMAIL=<qa-user-email>`
- `PLAYWRIGHT_DASHBOARD_PASSWORD=<qa-user-password>`
- `PLAYWRIGHT_VERIFICATION_MODE=staging`

Then execute:

```powershell
pnpm verify:dashboard
```

The harness seeds a verification batch through `POST /api/testing/dashboard-verification/seed`, checks login, agency selection, patient queue rendering, `OASIS Gate`, and `AI Plan of Care`, then writes `artifacts/dashboard-verification/dashboard-verification-staging.json`.

## Autonomous Agency Loading

The API owns autonomous loading. The dashboard only displays the latest persisted API data.

On API startup, `BatchControlPlaneService.initialize()` does three launch-critical things:

1. Reconciles interrupted batches from previous task restarts.
2. Creates a Finale workbook batch for each active agency in `AUTONOMOUS_AGENCY_IDS` if one does not already exist.
3. Starts a scheduler that checks due agency reruns every 60 seconds.

For initialization, set:

```bash
API_AUTONOMOUS_MODE=manual_only
PATIENT_MEMORY_WRITE_ENABLED=true
DELTA_REUSE_ENABLED=true
AUTONOMOUS_AGENCY_IDS=star-home-health
DEFAULT_SUBSIDIARY_RERUN_ENABLED=false
DEFAULT_SUBSIDIARY_RERUN_INTERVAL_HOURS=24
DEFAULT_SUBSIDIARY_RERUN_LOCAL_TIMES=20:30
```

Then keep the API ECS service running continuously. Persisting `API_STORAGE_ROOT` on EFS is what lets the replacement task resume from the latest agency state instead of losing patient artifacts.

Populate patient memory from existing Star Home batch artifacts:

```powershell
pnpm exec tsx services/api/src/scripts/migratePatientMemory.ts --agency star-home-health
```

Rebuild dashboard projections from memory without portal, OCR, or LLM work:

```bash
curl -X POST "$API_BASE_URL/api/runs/{batchId}/start" \
  -H "content-type: application/json" \
  -d '{"mode":"delta","reprojectOnly":true}'
```

Run a controlled live bot pass only when the operator is ready:

```bash
curl -X POST "$API_BASE_URL/api/runs/{batchId}/sample" \
  -H "content-type: application/json" \
  -d '{"patientIds":["<workItemId>"],"mode":"delta","reprojectOnly":false}'
```

Use the explicit full override only when memory is suspect:

```bash
curl -X POST "$API_BASE_URL/api/runs/{batchId}/sample" \
  -H "content-type: application/json" \
  -d '{"patientIds":["<workItemId>"],"mode":"full","reprojectOnly":false}'
```

After Star Home has two clean scheduled cycles, switch the API task environment to `API_AUTONOMOUS_MODE=full`, set `DEFAULT_SUBSIDIARY_RERUN_ENABLED=true`, keep `DELTA_REUSE_ENABLED=true`, and expand `AUTONOMOUS_AGENCY_IDS` agency by agency. Scheduled autonomous runs use `DEFAULT_SUBSIDIARY_RERUN_LOCAL_TIMES`; the production default is one daily run at `20:30` Asia/Manila until the cadence is intentionally increased.

Manual first-run or catch-up options:

- From the dashboard: sign in, select an agency, click `Run Agency Refresh`.
- From a local/admin shell against the repo: `cmd /c pnpm exec tsx services/api/src/testing/runAgencyRefreshes.ts star-home-health --mode delta --timeout-ms 7200000`.
- Dashboard-only preload from a local/admin shell: `cmd /c pnpm exec tsx services/api/src/testing/runAgencyRefreshes.ts star-home-health --mode delta --reproject-only --timeout-ms 7200000`.
- From HTTP/API tooling: `POST /api/agencies/{agencyId}/refresh`.

The dashboard auto-refreshes while backend work is running, so QA users should see patient rows populate as the API finishes workbook acquisition, patient matching, OASIS capture, referral capture, OCR/Textract, LLM processing, and dashboard-state writing.

## Deploying Code Updates

Each code push should deploy new container images, but deployment alone does not mean every patient is immediately re-scraped. The re-scrape happens when one of these occurs:

- The API starts and an active agency has no current Finale-backed batch.
- A scheduled rerun becomes due based on `DEFAULT_SUBSIDIARY_RERUN_INTERVAL_HOURS`.
- A QA/admin user starts `Run Agency Refresh`.
- An admin runs `runAgencyRefreshes.ts --all`.

Recommended launch workflow for each push:

1. Push code to GitHub.
2. CI builds and pushes new `medical-ai-qa-api:prod` and `medical-ai-qa-dashboard:prod` images to ECR.
3. CI registers updated ECS task definitions.
4. CI forces new deployments for API and dashboard services.
5. After the API service is healthy, run an all-agency refresh if the release needs freshly scraped data immediately.

For hands-off production, keep scheduled reruns enabled and use manual all-agency refresh only for launch day, demos, or urgent data refreshes.

## Build Images

```bash
docker build -f services/api/Dockerfile -t medical-ai-qa-api:prod .
docker build -f apps/dashboard/Dockerfile -t medical-ai-qa-dashboard:prod .
```

Notes:

- `.dockerignore` excludes local `.env.local` files and runtime control-plane data, so image builds should start from code plus package metadata only.
- The dashboard image now uses Next.js standalone output, which keeps the runtime image smaller and avoids shipping the entire workspace into the serving container.
- The API image now copies the Plan of Care question-bank assets into the runtime image; do not skip question-bank normalization before building.

## Push Images To ECR

Set variables:

```bash
export AWS_REGION=us-west-2
export AWS_ACCOUNT_ID=123456789012
export API_REPO=medical-ai-qa-api
export DASHBOARD_REPO=medical-ai-qa-dashboard
```

Create repositories once:

```bash
aws ecr create-repository --repository-name "$API_REPO" --region "$AWS_REGION"
aws ecr create-repository --repository-name "$DASHBOARD_REPO" --region "$AWS_REGION"
```

Authenticate Docker:

```bash
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
```

Build, tag, and push:

```bash
docker build -f services/api/Dockerfile -t "$API_REPO:prod" .
docker build -f apps/dashboard/Dockerfile -t "$DASHBOARD_REPO:prod" .

docker tag "$API_REPO:prod" "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$API_REPO:prod"
docker tag "$DASHBOARD_REPO:prod" "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$DASHBOARD_REPO:prod"

docker push "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$API_REPO:prod"
docker push "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$DASHBOARD_REPO:prod"
```

## ECS/Fargate Rollout

1. Create or select a VPC with public subnets for the ALB and private subnets for ECS tasks.
2. Create an EFS file system and mount targets for the private subnets used by the API service.
3. Create ECR repositories and push the images.
4. Create Secrets Manager secrets for dashboard auth and backend automation credentials.
5. Create CloudWatch log groups:
   - `/ecs/medical-ai-qa-api`
   - `/ecs/medical-ai-qa-dashboard`
   - `/medical-ai-qa/dashboard-auth` if auth audit logging is enabled
6. Create or update IAM roles:
   - ECS task execution role: pull ECR images, write container logs, and read injected Secrets Manager values.
   - API task role: S3/Textract/Bedrock/portal automation permissions required by the backend.
   - Dashboard task role: CloudWatch Logs permissions for auth audit logging if enabled.
7. Create two ALB target groups with target type `ip`:
   - Dashboard target group on container port `3001`.
   - API target group on container port `3000`.
8. Configure ALB listener rules:
   - default `/` traffic -> dashboard target group
   - `/api/*` -> API target group
9. Replace placeholders in:
   - `deploy/aws/ecs/api-task-definition.json`
   - `deploy/aws/ecs/dashboard-task-definition.json`
10. Register both ECS task definitions.
11. Create or update ECS services for the API and dashboard.

Register task definitions:

```bash
aws ecs register-task-definition --cli-input-json file://deploy/aws/ecs/api-task-definition.json --region "$AWS_REGION"
aws ecs register-task-definition --cli-input-json file://deploy/aws/ecs/dashboard-task-definition.json --region "$AWS_REGION"
```

Force a new deployment after task definition or secret changes:

```bash
aws ecs update-service --cluster medical-ai-qa --service medical-ai-qa-api --force-new-deployment --region "$AWS_REGION"
aws ecs update-service --cluster medical-ai-qa --service medical-ai-qa-dashboard --force-new-deployment --region "$AWS_REGION"
```

For a demo/staging API service, register a task definition variant with:

```json
{ "name": "API_AUTONOMOUS_MODE", "value": "manual_only" }
{ "name": "DEFAULT_SUBSIDIARY_RERUN_ENABLED", "value": "false" }
{ "name": "FINALE_PATIENT_CONCURRENCY", "value": "1" }
```

Keep production on `API_AUTONOMOUS_MODE=full` only after the demo is signed off.

## Smoke Test

1. Open `http://medical-ai-qa-prod-alb-925770298.us-east-2.elb.amazonaws.com/login`.
2. Sign in with a dashboard QA account.
3. Select an assigned agency.
4. Confirm `/agency` loads the latest queue.
5. Open a patient and confirm OASIS Snapshot, Compare All, Source Documents, missing referral indicators, and the `AI Plan of Care` tab render as expected.
6. Confirm a user cannot select an agency outside their `allowedAgencyIds`.
7. If audit logging is enabled, confirm CloudWatch receives `login_succeeded`, `login_failed`, `agency_selected`, and `logout_succeeded` events.
8. Confirm each agency has either an active refresh cycle or a clear error message on the agency page.
9. Confirm CloudWatch API logs show scheduled initialization for all agencies in `AUTONOMOUS_AGENCY_IDS`.
10. For demo/staging, run `pnpm verify:dashboard` and confirm the generated report shows:
   - release gate passed
   - Nova Pro configured
   - no `skipped_missing_question_bank` status
   - seeded `limited_preview`, `blocked_missing_evidence`, and `skipped_oasis_gate` states rendered as expected

## Operational Notes

- Changing `DASHBOARD_QA_USERS_JSON` does not update already-running containers. Force a new dashboard deployment after changing users or passwords.
- Do not store portal usernames/passwords in dashboard secrets. Those belong to the API/intake task only.
- Keep `OASIS_WRITE_ENABLED=false` until the deployment is intentionally approved for portal writeback.
- Use the agency dashboard to start or observe backend refreshes; do not expose workbook upload as the production QA path.

## AWS References

- Amazon ECR image push flow: https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html
- ECS task definition secrets from Secrets Manager: https://docs.aws.amazon.com/AmazonECS/latest/userguide/secrets-envvar-secrets-manager.html
- ECS with Application Load Balancers and `ip` target groups for `awsvpc` tasks: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html
- ALB target groups and listener routing: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-target-group.html

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

- `NEXT_PUBLIC_API_BASE_URL=https://YOUR_ALB_DNS/api`
- `DASHBOARD_SESSION_TTL_HOURS=12`
- `DASHBOARD_ALLOW_PLAINTEXT_PASSWORDS=false`
- `DASHBOARD_SESSION_SECRET` from Secrets Manager
- `DASHBOARD_QA_USERS_JSON` from Secrets Manager
- Optional audit logging:
  - `DASHBOARD_AUTH_AUDIT_LOG_GROUP=/medical-ai-qa/dashboard-auth`
  - `DASHBOARD_AUTH_AUDIT_AWS_REGION=<REGION>`

API container:

- `API_PORT=3000`
- `API_HOST=0.0.0.0`
- `API_STORAGE_ROOT=/data/control-plane`
- `API_LOG_LEVEL=info`
- `API_CORS_ORIGIN=https://YOUR_ALB_DNS`
- `OASIS_WRITE_ENABLED=false` for read-only QA deployment
- `AUTONOMOUS_AGENCY_IDS=aplus-home-health,active-home-health,avery-home-health,meadows-home-health,star-home-health`
- `DEFAULT_SUBSIDIARY_RERUN_ENABLED=true`
- `DEFAULT_SUBSIDIARY_RERUN_INTERVAL_HOURS=24`
- `PORTAL_HEADLESS=true`
- `CODE_LLM_ENABLED=true`
- `LLM_PROVIDER=bedrock`
- `BEDROCK_REGION=<BEDROCK_REGION>`
- `BEDROCK_MODEL_ID=<BEDROCK_MODEL_ID>`
- `TEXTRACT_S3_REGION=<TEXTRACT_S3_REGION>`
- `TEXTRACT_S3_BUCKET=<TEXTRACT_S3_BUCKET>`
- `TEXTRACT_S3_PREFIX=finale-workbook-intake/textract`

Store portal, Bedrock, Textract, and any other backend automation secrets in Secrets Manager and inject them into the API task definition. Dashboard users do not need those portal credentials.

## Autonomous Agency Loading

The API owns autonomous loading. The dashboard only displays the latest persisted API data.

On API startup, `BatchControlPlaneService.initialize()` does three launch-critical things:

1. Reconciles interrupted batches from previous task restarts.
2. Creates a Finale workbook batch for each active agency in `AUTONOMOUS_AGENCY_IDS` if one does not already exist.
3. Starts a scheduler that checks due agency reruns every 60 seconds.

For launch, set:

```bash
AUTONOMOUS_AGENCY_IDS=aplus-home-health,active-home-health,avery-home-health,meadows-home-health,star-home-health
DEFAULT_SUBSIDIARY_RERUN_ENABLED=true
DEFAULT_SUBSIDIARY_RERUN_INTERVAL_HOURS=24
```

Then keep the API ECS service running continuously. If the task stops, scheduled reruns stop until ECS starts a replacement task. Persisting `API_STORAGE_ROOT` on EFS is what lets the replacement task resume from the latest agency state instead of losing patient artifacts.

Manual first-run or catch-up options:

- From the dashboard: sign in, select an agency, click `Run Agency Refresh`.
- From a local/admin shell against the repo: `cmd /c pnpm exec tsx services/api/src/testing/runAgencyRefreshes.ts --all --timeout-ms 7200000`.
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

## Smoke Test

1. Open `https://YOUR_ALB_DNS/login`.
2. Sign in with a dashboard QA account.
3. Select an assigned agency.
4. Confirm `/agency` loads the latest queue.
5. Open a patient and confirm OASIS Snapshot, Compare All, Source Documents, and missing referral indicators render as expected.
6. Confirm a user cannot select an agency outside their `allowedAgencyIds`.
7. If audit logging is enabled, confirm CloudWatch receives `login_succeeded`, `login_failed`, `agency_selected`, and `logout_succeeded` events.
8. Confirm each agency has either an active refresh cycle or a clear error message on the agency page.
9. Confirm CloudWatch API logs show scheduled initialization for all agencies in `AUTONOMOUS_AGENCY_IDS`.

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

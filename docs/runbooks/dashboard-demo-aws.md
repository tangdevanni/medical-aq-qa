# Dashboard Demo AWS Deployment

## Target Architecture

- `apps/dashboard`
  Next.js UI exposed behind the public Application Load Balancer.
- `services/api`
  Fastify control-plane API that handles workbook upload, parsing, run orchestration, and patient artifact queries.
- `Amazon ECS on Fargate`
  Separate services for `dashboard` and `api`.
- `Application Load Balancer`
  Default rule routes `/` to the dashboard target group.
  Path rule routes `/api/*` to the API target group.
- `Amazon ECR`
  Stores the dashboard and API container images.
- `AWS Secrets Manager`
  Stores portal credentials, OpenAI credentials, and any runtime secrets required by the underlying automation services.
- `Amazon EFS`
  Mounted into the API service at `/data/control-plane` so uploaded workbooks, run metadata, patient statuses, and generated artifacts survive task restarts.

## Environment Strategy

Dashboard container:

- `NEXT_PUBLIC_API_BASE_URL=https://YOUR_ALB_DNS/api`

API container:

- `API_PORT=3000`
- `API_HOST=0.0.0.0`
- `API_STORAGE_ROOT=/data/control-plane`
- `API_LOG_LEVEL=info`
- `API_CORS_ORIGIN=https://YOUR_ALB_DNS`
- `OASIS_WRITE_ENABLED=false`

Secrets Manager values should be injected into the API task definition for the existing automation dependencies, including portal credentials and any LLM/API keys already used by `services/finale-workbook-intake`.

## Local Docker Launch

Build and run:

```bash
docker compose -f docker-compose.demo.yml up --build
```

Open:

- Dashboard: `http://localhost:3001`
- API: `http://localhost:3000`

Stop:

```bash
docker compose -f docker-compose.demo.yml down
```

## Build Images

```bash
docker build -f services/api/Dockerfile -t medical-ai-qa-api:demo .
docker build -f apps/dashboard/Dockerfile -t medical-ai-qa-dashboard:demo .
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
docker build -f services/api/Dockerfile -t "$API_REPO:demo" .
docker build -f apps/dashboard/Dockerfile -t "$DASHBOARD_REPO:demo" .

docker tag "$API_REPO:demo" "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$API_REPO:demo"
docker tag "$DASHBOARD_REPO:demo" "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$DASHBOARD_REPO:demo"

docker push "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$API_REPO:demo"
docker push "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$DASHBOARD_REPO:demo"
```

## ECS/Fargate Rollout

1. Create an EFS file system and mount target for the private subnets used by ECS.
2. Create or update the ECS task execution role and task role.
3. Store runtime secrets in Secrets Manager.
4. Register the task definitions from `deploy/aws/ecs/api-task-definition.json` and `deploy/aws/ecs/dashboard-task-definition.json` after replacing the placeholder values.
5. Create two ECS services:
   - `medical-ai-qa-api-demo`
   - `medical-ai-qa-dashboard-demo`
6. Attach both services to the same ALB:
   - default listener rule -> dashboard target group
   - `/api/*` rule -> API target group
7. Set the dashboard service environment variable `NEXT_PUBLIC_API_BASE_URL` to `https://YOUR_ALB_DNS/api`.

Register task definitions:

```bash
aws ecs register-task-definition --cli-input-json file://deploy/aws/ecs/api-task-definition.json --region "$AWS_REGION"
aws ecs register-task-definition --cli-input-json file://deploy/aws/ecs/dashboard-task-definition.json --region "$AWS_REGION"
```

Force a new deployment after the task definition revision changes:

```bash
aws ecs update-service --cluster medical-ai-qa-demo --service medical-ai-qa-api-demo --force-new-deployment --region "$AWS_REGION"
aws ecs update-service --cluster medical-ai-qa-demo --service medical-ai-qa-dashboard-demo --force-new-deployment --region "$AWS_REGION"
```

## Demo Flow

1. Open the dashboard at the ALB URL.
2. Go to `New Run`.
3. Upload any Finale `.xlsx` export, regardless of filename.
4. Confirm the detected worksheet signatures and preview rows.
5. Click `Run QA`.
6. Open the run detail page and watch live patient-by-patient status updates.
7. Open a patient detail page to review workbook context, OCR/coding output, lock state, verification result, planned OASIS actions, and execution result.

# Subsidiary Runtime Config

## Launch shape

- The product currently runs with one default active subsidiary.
- Workbook uploads, batch runs, and 24-hour reruns all resolve that default subsidiary when no `subsidiaryId` is supplied.
- Additional subsidiaries can be added later by inserting a new subsidiary record plus a credentials secret, without changing the workflow code.

## Local development

Set:

- `SUBSIDIARY_CONFIG_MODE=local_env`
- `DEFAULT_SUBSIDIARY_ID`
- `DEFAULT_SUBSIDIARY_SLUG`
- `DEFAULT_SUBSIDIARY_NAME`
- `DEFAULT_SUBSIDIARY_PORTAL_BASE_URL`
- `PORTAL_USERNAME`
- `PORTAL_PASSWORD`

Optional:

- `DEFAULT_SUBSIDIARY_PORTAL_DASHBOARD_URL`
- `DEFAULT_SUBSIDIARY_RERUN_ENABLED`
- `DEFAULT_SUBSIDIARY_RERUN_INTERVAL_HOURS`
- `DEFAULT_SUBSIDIARY_TIMEZONE`

The local fallback is isolated to the portal credential provider. The active workflow does not read raw portal credentials directly from business logic.

## AWS production

Store the portal credentials in AWS Secrets Manager as JSON:

```json
{
  "username": "portal-user",
  "password": "portal-password"
}
```

Recommended ECS task configuration:

- `SUBSIDIARY_CONFIG_MODE=aws_secrets_manager`
- `DEFAULT_SUBSIDIARY_ID`
- `DEFAULT_SUBSIDIARY_SLUG`
- `DEFAULT_SUBSIDIARY_NAME`
- `DEFAULT_SUBSIDIARY_PORTAL_BASE_URL`
- `DEFAULT_SUBSIDIARY_PORTAL_DASHBOARD_URL`
- `DEFAULT_SUBSIDIARY_PORTAL_CREDENTIALS_SECRET_ARN`
- `DEFAULT_SUBSIDIARY_PORTAL_CREDENTIALS_ENV_VAR=DEFAULT_SUBSIDIARY_PORTAL_CREDENTIALS_JSON`

Inject the Secrets Manager value into the ECS container as:

- `DEFAULT_SUBSIDIARY_PORTAL_CREDENTIALS_JSON`

The API resolves the subsidiary record first, then reads the injected secret payload through the credential provider layer.

## Scheduler

- EventBridge Scheduler remains the production recurrence mechanism.
- The API control plane persists schedule metadata with `subsidiaryId`, `batchId`, `lastRunAt`, and `nextScheduledRunAt`.
- Replacing the active workbook deactivates the older schedule for that subsidiary and activates the new batch schedule.

# medical-ai-qa

Monorepo scaffold for an internal medical portal QA automation system. The repository is split into service packages for orchestration, browser automation, and HTTP health endpoints, plus shared packages for types, config, and logging.

## Workspace

- `services/orchestrator`: accepts portal jobs and dispatches them.
- `services/portal-worker`: runs Playwright-backed login workflows.
- `services/api`: exposes a basic health endpoint.
- `packages/shared-types`: shared DTOs and workflow types.
- `packages/shared-config`: constants and default runtime settings.
- `packages/shared-logging`: lightweight structured logger.
- `docs`: portal maps and operator runbooks.

## Getting Started

```bash
pnpm install
pnpm build
pnpm typecheck
```

To start an individual service in development:

```bash
pnpm dev:api
pnpm dev:orchestrator
pnpm dev:portal-worker
```

## Notes

- The portal worker is scaffolded for a login flow and should be extended with per-portal selectors and post-login assertions.
- The orchestrator currently uses a local dispatch stub. Replace it with queue or RPC integration when the service boundaries are finalized.
- An unrelated legacy Java file remains under `src/Main.java` and was left untouched.

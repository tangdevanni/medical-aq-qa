# AGENTS

## Repository Rules

- Keep cross-service contracts in `packages/shared-types`.
- Put environment parsing close to each service instead of reading `process.env` throughout the codebase.
- Prefer small adapters at service boundaries so Playwright logic stays isolated inside `services/portal-worker`.
- Add portal-specific selectors under `services/portal-worker/src/portal/selectors`.
- Document portal quirks in `docs/portal-maps` and operator workflows in `docs/runbooks`.

## Coding Notes

- Use `pnpm -r typecheck` before handing off changes.
- Redact secrets before sending any audit event to logs.
- Avoid service-to-service imports from `src` trees; use shared packages or explicit APIs.

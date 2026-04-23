# Portal Login Testing

1. Copy `services/portal-worker/.env.example` to `.env` and fill in a non-production credential set.
2. Confirm selectors in `docs/portal-maps/finale-health.md` still match the target portal.
3. Start the worker with `pnpm dev:portal-worker`.
4. Run a single `PortalJob` through the worker using a local harness or REPL.
5. Review logs for redacted audit events and confirm the landing page assertion passes.

If the login step breaks, capture a screenshot and update the selector map before changing workflow code.

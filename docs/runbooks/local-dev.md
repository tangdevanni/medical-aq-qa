# Local Development

## Prerequisites

- Node.js 20+
- `pnpm`

## Setup

1. Run `pnpm install` at the repository root.
2. Copy `.env.example` and `services/portal-worker/.env.example` as needed for local values.
3. Run `pnpm build` to compile all packages.
4. Run `pnpm typecheck` to validate the workspace.

## Service Commands

- API: `pnpm dev:api`
- Orchestrator: `pnpm dev:orchestrator`
- Portal worker: `pnpm dev:portal-worker`

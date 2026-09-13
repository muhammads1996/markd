# MARKD

MARKD is an operator-led work platform for a provenance-aware, bilateral construction Work Graph. This repository is the TypeScript monorepo foundation for the operator web application and its canonical Supabase/PostgreSQL data layer.

This bootstrap intentionally contains no product domain schema, authentication, WhatsApp integration, AI parsing, matching, or onboarding flows. Those are implemented one Linear issue at a time.

## Prerequisites

- Node.js 24.21.0
- Corepack
- Docker Desktop or another Docker-compatible engine
- Git

## Clean-clone setup

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm db:start
corepack pnpm env:local
corepack pnpm dev
```

Open <http://localhost:3000>. `env:local` creates `apps/web/.env.local` from the running local Supabase stack. It copies only the public API URL and publishable key and refuses to replace an existing file.

### Environment files

- Local development uses ignored `apps/web/.env.local`. Generate it with `pnpm env:local`; do not copy the database URL, secret key, JWT secret, service-role key, or S3 credentials from `supabase status` into browser-visible variables.
- Production uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the deployment provider's environment settings. For a local production-mode run, place those values in ignored `apps/web/.env.production.local`.
- `.env.example` documents the variable contract and intentionally contains no environment credentials.

## Quality checks

```powershell
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm db:reset
corepack pnpm test:integration
corepack pnpm db:types:check
corepack pnpm build
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
```

`pnpm test` runs both unit and integration tests, so the local Supabase stack must be running. Playwright starts the already-built production application automatically.

## Local Supabase workflow

```powershell
corepack pnpm db:start
corepack pnpm db:status
corepack pnpm db:migration:new descriptive_name
corepack pnpm db:reset
corepack pnpm db:types
corepack pnpm db:stop
```

- `db:reset` discards local database changes, reapplies every committed migration, and reseeds only if a later issue adds seed data.
- `db:types` writes generated public-schema types to `packages/db/src/database.types.ts`.
- `db:types:check` fails when that generated file is stale.
- Remote linking, pushes, production migrations, schema design, RLS, auth, and storage policies are outside FLO-123.

The integration suite uses `postgresql://postgres:postgres@127.0.0.1:54322/postgres` by default. Set `SUPABASE_DB_URL` to test another local connection explicitly.

## Workspace layout

- `apps/web` — Next.js operator PWA shell.
- `packages/domain` — future pure domain commands and policies.
- `packages/db` — generated database types and future repositories.
- `packages/contracts` — future shared validation contracts.
- `packages/messaging`, `packages/language`, `packages/i18n`, `packages/observability` — reserved boundaries defined by the architecture; currently empty.
- `supabase` — local Supabase configuration, future migrations, and future Edge Functions.
- `tests` — unit, local integration, and Playwright suites.

Read `AGENTS.md` before implementing an issue. Linear is the product and scope source of truth; repository code, migrations, and tests are implementation truth.

## Canonical language

- **Stamp** — action or command.
- **Workmark** — durable provenance-aware record.
- **Work Card** — derived profile/read model.
- **Work Graph** — bilateral relationship graph.

Canonical references:

- [FLO-123](https://linear.app/flowtation/issue/FLO-123/bootstrap-markd-repository-and-codex-ready-development-environment)
- [Technical Architecture v1](https://linear.app/flowtation/document/technical-architecture-v1-markd-app-whatsapp-and-workmark-pipeline-f30c418efca3)
- [PRD v1](https://linear.app/flowtation/document/prd-v1-markd-work-graph-operating-platform-bb2642845866)
- [Strategy v1](https://linear.app/flowtation/document/strategy-v1-markd-work-graph-and-cape-town-wedge-7135d8460704)

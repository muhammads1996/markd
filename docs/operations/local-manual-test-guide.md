# Local manual test guide

This guide is for the local Supabase, FastAPI, and Next.js development stack.
All identities and data below are synthetic. Do not run the SQL against a
hosted Supabase project or use these credentials outside local development.

## Start the local stack

From the repository root, start Supabase and generate the web application's
browser-safe environment file:

```powershell
corepack pnpm db:start
corepack pnpm env:local
```

`env:local` only creates `apps/web/.env.local` when it does not exist. If it
reports that the file already exists, it has left the file unchanged and you
can continue. To deliberately regenerate it after changing the local Supabase
stack, first check that it contains only the generated public values, then run:

```powershell
Remove-Item apps/web/.env.local
corepack pnpm env:local
```

Do not remove the file when it contains manually maintained browser settings.

Set the server-only local values in ignored `.env` or `apps/api/.env` using
`corepack pnpm db:status` and the variable names in `.env.example`. Then start
the API and web app in separate terminals:

```powershell
corepack pnpm api:dev
```

```powershell
$env:MARKD_PARTICIPANT_FIXTURES = "1"
corepack pnpm dev
```

The fixture flag enables preview routes only in development. Restart `pnpm dev`
after changing it. Open the web app at <http://localhost:3000> and FastAPI
OpenAPI at <http://127.0.0.1:8000/docs>.

## Local operator sign-in

After `corepack pnpm db:reset`, add this synthetic operator through the local
Supabase Studio SQL editor. `corepack pnpm db:status` prints the Studio URL.

```sql
do $$
declare
  operator_id uuid := '90000000-0000-4000-8000-000000000001';
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change, email_change_token_current,
    email_change_token_new, reauthentication_token, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at
  ) values (
    operator_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'operator@example.test',
    crypt('Markd-Local-2026!', gen_salt('bf')), now(), '', '', '', '', '', '',
    '{}', '{}', now(), now()
  )
  on conflict (id) do update set
    email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = now(),
    updated_at = now();

  insert into public.operator_accounts (user_id, role)
  values (operator_id, 'ops_admin')
  on conflict (user_id) do update set
    role = 'ops_admin',
    archived_at = null;
end
$$;
```

Sign in at <http://localhost:3000/sign-in> with:

```text
Email: operator@example.test
Password: Markd-Local-2026!
```

## Participant previews

These routes use in-memory synthetic fixtures and do not require a sign-in.
They are intended for checking worker and contractor states, mobile layouts,
and local-only UI interactions.

### Worker

Use `view=home`, `work`, `card`, or `profile`:

```text
http://localhost:3000/participant/preview/worker?view=home&scenario=travel_ready
http://localhost:3000/participant/preview/worker?view=home&scenario=offer
http://localhost:3000/participant/preview/worker?view=home&scenario=accepted_waiting
http://localhost:3000/participant/preview/worker?view=home&scenario=cancelled
http://localhost:3000/participant/preview/worker?view=home&scenario=no-work
http://localhost:3000/participant/preview/worker?view=home&scenario=completed
http://localhost:3000/participant/preview/worker?view=home&scenario=degraded
http://localhost:3000/participant/preview/worker?view=work
http://localhost:3000/participant/preview/worker?view=card
http://localhost:3000/participant/preview/worker?view=profile
```

For the `offer` state, test `Take job`, `Can't go`, and `Call me`. Taking a job
must show a waiting state and must not authorise travel. Only `travel_ready`
should show travel authorisation.

### Contractor

Use `view=home`, `hire`, `workers`, `jobs`, or `empty`:

```text
http://localhost:3000/participant/preview/contractor?view=home
http://localhost:3000/participant/preview/contractor?view=hire
http://localhost:3000/participant/preview/contractor?view=workers
http://localhost:3000/participant/preview/contractor?view=jobs
http://localhost:3000/participant/preview/contractor?view=empty
```

Check the bottom navigation at a phone viewport, including a view transition.
It must remain fixed to the viewport bottom and span the viewport width.

## Operator and seeded Work Graph views

After signing in, use the deterministic seed data created by `db:reset`:

```text
http://localhost:3000/operator
http://localhost:3000/operator/onboard
http://localhost:3000/search
http://localhost:3000/workers/10000000-0000-4000-8000-000000000001
http://localhost:3000/workers/10000000-0000-4000-8000-000000000003
http://localhost:3000/contractors/20000000-0000-4000-8000-000000000001
```

Suggested manual pass:

1. Create a worker and a contractor through `/operator/onboard`.
2. Search for `+27 82 000 0002` and confirm the result is `Example Build`.
3. Open Anele's worker record and verify confirmed Workmark evidence and skills.
4. Open Lebo's worker record and verify the historical claim remains distinct.
5. Open Example Build and verify its known labour network.

The seeded WhatsApp ProposedAction is already approved, so the Ops Inbox starts
clear. A new pending action is created only by the WhatsApp pipeline or the
test fixture; do not alter the seed merely to simulate an inbox item.

## WhatsApp testing

### Deterministic automated coverage

Run the FastAPI suite without Meta or OpenRouter credentials. It covers webhook
signature validation, idempotency, processing, worker responses, delivery
queueing, and provenance rules:

```powershell
corepack pnpm api:test
```

For the browser preview and mobile UI surface:

```powershell
$env:MARKD_PARTICIPANT_FIXTURES = "1"
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3000"
corepack pnpm exec playwright test tests/e2e/participant-preview.spec.ts
```

For clean production-mode browser coverage, stop `pnpm dev` first:

```powershell
corepack pnpm test:e2e
```

### Credentialed Meta and OpenRouter smoke test

Use a Meta test number and test participant only. Put provider values in the
ignored server-only environment file; never add them to browser environment
variables, source control, screenshots, or logs. Follow the complete sequence
in [whatsapp-openrouter-pilot-smoke.md](whatsapp-openrouter-pilot-smoke.md):

1. Start the worker in a separate terminal with `corepack pnpm api:worker`.
2. Tunnel `http://127.0.0.1:8000/webhooks/whatsapp` over HTTPS and configure
   Meta to call that URL.
3. Send a test text or voice message, then inspect the resulting pending Ops
   Inbox item at <http://localhost:3000/operator/inbox>.
4. Confirm, edit, or reject it as an operator. No proposed action may mutate
   the Work Graph before operator approval.
5. Replay the provider payload and verify that it creates no duplicate
   ChannelEvent or ProposedAction.

The existing smoke runbook includes the precise provider evidence, delivery,
failure, and media-retention checks. It also documents the restricted live
provider validation command.

## Full local verification

Run this after a coherent change. `db:reset` is destructive to local data.

```powershell
corepack pnpm format:check
corepack pnpm lint
corepack pnpm api:lint
corepack pnpm api:typecheck
corepack pnpm api:test
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm db:reset
corepack pnpm test:integration
corepack pnpm db:types:check
corepack pnpm build
corepack pnpm test:e2e
```

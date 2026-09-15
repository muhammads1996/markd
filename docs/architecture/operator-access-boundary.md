# Operator access boundary

FLO-105 makes Supabase Auth identity necessary but not sufficient for access to
the MARKD operator application. An authenticated user must have an active row
in `public.operator_accounts`, keyed by `auth.users.id`, with one of the live
roles below:

- `ops_user` can read and operate on the private work-graph records needed for
  field work. It cannot read the audit log or administer accounts.
- `ops_admin` has the same operational access and can read audit events,
  manage operator accounts, and maintain reference data.

There is no worker or contractor login. Public, anonymous, and authenticated
but unprovisioned users cannot retrieve Work Graph records or Work Cards.

## Provisioning and revocation

Operator provisioning is an admin-controlled action. Create an Auth user in
Supabase and create its `operator_accounts` row using a trusted admin/database
workflow; public email signup is disabled in `supabase/config.toml`. Archiving
the row immediately removes access because RLS checks the live table, rather
than editable user metadata or cached custom claims. Operator accounts are not
hard-deleted.

## RLS and audit rules

Every public Work Graph and private-detail table has RLS enabled. Explicit
privileges are revoked from `anon`; `authenticated` receives only the minimum
table privileges required for its policies, and no operator has `DELETE`
privileges. Security-definer helper functions have a fixed search path, check
`auth.uid()`, and are not executable by `PUBLIC`.

Trust-relevant audit events preserve the authenticated `operator_account_id`
and, when linked, its operational person. Backend commands can still identify
system work explicitly. Audit rows remain append-only and are readable only by
active `ops_admin` operators.

## Private fields, Work Cards, and media

Person notes and worker dates of birth are held in private-detail tables.
`operator_work_cards` is a security-invoker, allowlisted internal projection;
it deliberately excludes notes, birth dates, phone numbers, verification
documents, and exception information. It is not public or shareable.

Worker portraits use the private `worker-portraits` bucket. Sensitive
verification media uses the private `worker-verification-media` bucket.
Neither bucket is public. Storage object policies require an active operator
and restrict paths to `workers/<worker-uuid>/...`. Operator clients may issue
signed URLs only after RLS authorises the source object; application callers
must keep the expiry at or below five minutes. Media is archived rather than
deleted when operational history needs to remain explainable.

## Backup/restore drill

`pnpm db:backup-restore-drill` is an executable local-only drill. It refuses
to run unless `MARKD_RUN_DISPOSABLE_BACKUP_RESTORE_DRILL=1` and the database
target is the local Supabase port (`127.0.0.1:54322`). It dumps the disposable
local database, restores into an isolated database in the local Docker
container, asserts the synthetic Work Graph and allowlisted Work Card are
present, then removes the restore database and temporary dump. It cannot
target a linked or production project.

Before production rollout, repeat an equivalent restore drill against a
separate disposable project and record recovery time, active-operator access,
archived-operator denial, anonymous denial, and result in the deployment
change record. Do not run restore experiments against a production project.

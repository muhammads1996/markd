# FastAPI WhatsApp and OpenRouter pilot smoke runbook

This runbook is for the credentialed pilot smoke test. Do not run it against
production participants or place credentials in tracked files, browser
variables, logs, fixtures, issue comments, or screenshots.

## Configure the private environment

1. Start local Supabase. Generate `apps/web/.env.local` with
   `corepack pnpm env:local` only when it does not already exist. An
   "already exists; it was not changed" error is expected and means the
   existing file was preserved; continue with the next step. To deliberately
   regenerate it after replacing the local Supabase stack, first confirm it
   contains only generated public values, then delete it and rerun the command.
2. Add the blank server-only values from `.env.example` to ignored `.env` or
   `apps/api/.env`. Preserve the generated browser-only `NEXT_PUBLIC_` values
   in `apps/web/.env.local`.
3. Create a Meta Cloud API test number and set its access token, phone number
   ID, app secret, and webhook verify token. The adapter pins the Graph API
   version and private-media size limit in source.
4. Create an OpenRouter key. Its presence enables the FastAPI-only provider;
   model routes and conservative caps are configured in `apps/api/.env`.
5. Start local Supabase, FastAPI, and Next.js in separate terminals:
   `corepack pnpm db:start`, `corepack pnpm api:dev`, and `corepack pnpm dev`.
   `corepack pnpm api:worker` processes one queue pass and exits. For live
   provider testing, run a continuous local worker with
   `uv run --project apps/api python apps/api/run.py worker --continuous`.
   Production runs a separate deployment of the same FastAPI image with
   `MARKD_PROCESS_ROLE=worker`; that process polls the durable queue and logs
   failed passes while database leases/retries retain operational recovery state.
6. Expose FastAPI through an HTTPS tunnel. Configure Meta's callback as
   `https://<tunnel-host>/webhooks/whatsapp`, subscription field `messages`.

The application accesses every provider secret only in server route handlers
and server-only provider configuration. `whatsapp-media` is a private storage
bucket; source media can only be signed for an active operator for at most five
minutes through `/api/operator/channel-media/<asset-id>`.

## WhatsApp participant identity boundary

An authenticated Meta webhook establishes the source of an inbound
`ChannelEvent`; it does not establish a PWA login. For a worker command, the
webhook transaction captures the sender's normalized phone ownership and
active role in immutable channel actor evidence. Processing uses that
snapshot, so a delayed message cannot be attributed to a later phone owner.
The worker proceeds only when the event resolved to one active worker. A
hirer event similarly binds one active OrganisationContact and Organisation
and stays Ops-reviewed for labour requests, confirmations, and logistics.
The channel-scoped actor does not require or create a
`participant_account`, Supabase Auth user, browser session, or headless PWA
identity. Phone numbers remain contact evidence, not permanent primary IDs.

If ownership is missing, shared, duplicated, inactive, or otherwise ambiguous,
the worker must leave the event for Ops and must not execute a participant
command. Events from before the snapshot migration also require Ops review.
Semantic interpretation may help identify the requested action, but
it cannot establish identity or grant permission. Resolved WhatsApp actions
still pass through the same canonical command policy and state transitions as
PWA/Ops actions; the event and resulting command provenance must retain the
source channel/event and resolved actor/entity. Provider message deduplication
keeps replays from executing the same action twice.

For a controlled worker pilot, verify that an active WhatsApp-only worker with
no participant account can respond to one unambiguous offered Assignment with
the exact supported response. Acceptance is an acknowledgement only: the
Assignment remains **WAITING FOR CONFIRMATION — DO NOT TRAVEL YET** until the
canonical confirmation flow authorizes travel. Repeat with a shared/duplicate
phone ownership fixture and confirm it routes to Ops without changing the
Assignment. Worker availability and closeout/Stamp assertions use the same
canonical domain commands/policy as other capture channels.

## Live smoke sequence

1. In Meta, verify the webhook challenge. Confirm that a correct token returns
   the challenge and a mismatched token returns `403`; send a signed test
   payload and confirm an invalid signature returns `401`.
2. Send a real text message from the test sender. Confirm one `channel_events`
   row with its provider message ID, then run `corepack pnpm api:worker`. With OpenRouter
   enabled, confirm the Ops Inbox draft
   shows OpenRouter provider/model/cost/latency evidence in `interpretation`.
   The draft must remain pending and must not mutate the Work Graph.
3. Send one real WhatsApp voice note. Confirm its `channel_media_assets` row
   retains the provider media ID; run the worker and verify it stores the
   media in private `whatsapp-media`, preserves transcript and confidence, and
   displays both the transcript and the operator-only source-audio link in Ops
   Inbox. Repeat for English, Afrikaans, isiXhosa, and code-switched or unclear
   speech. Low-confidence transcripts must be marked ambiguous for review.
4. Send an intentionally messy synthetic text message. Confirm the OpenRouter
   result is a validated pending ProposedAction with `risk_tier=operational`.
   It must never apply a domain command without an operator approval.
5. Invoke `POST /internal/whatsapp/deliveries` on FastAPI with the
   `X-Internal-Service-Token: <INTERNAL_SERVICE_TOKEN>` header and a unique test
   JSON payload containing `recipient_phone_number`, `body`,
   `message_kind`, and `idempotency_key`; then run `corepack pnpm api:worker`.
   Confirm `channel_deliveries` contains Meta's provider message ID and `sent`
   state. Observe Meta status callbacks
   and confirm the record progresses to `delivered` or records `failed` evidence.
6. Replay the exact inbound provider payload. Confirm the unique provider
   message ID leaves one ChannelEvent, one processing job, and at most one
   non-archived ProposedAction. Replay a delivery callback and confirm it does
   not duplicate consequential records.
7. For a controlled network-failure check, temporarily block provider egress or
   use the configured staging provider failure mode. Confirm processing and
   delivery leases requeue with bounded exponential retries, retain a safe
   failure reason, recover expired leases, and become terminal after five
   attempts.
8. After a real test voice note is available, run
   `corepack pnpm api:test:providers -- --confirm-live --recipient <E.164-number> --voice-media-id <Meta-media-ID>`.
   The command validates the concrete adapters only and prints no message body,
   phone number, token, media URL, or raw provider payload.

## Evidence to retain

Record provider response IDs, timestamps, selected model IDs, fallback use,
cost, latency, delivery state, and the outcomes above in the pilot change
record. Keep raw source payloads and media private in Supabase; do not attach
them to Linear or source control.

Media is stored in the private `whatsapp-media` bucket only after a worker has
retrieved it. Retain source evidence according to the pilot retention policy;
operators can read it only through the existing short-lived authorized media
route. Failed retrievals retain a safe error and retry through the durable
lease queue; neither Meta media URLs nor provider credentials are exposed.

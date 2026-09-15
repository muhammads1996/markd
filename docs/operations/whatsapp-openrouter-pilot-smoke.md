# FastAPI WhatsApp and OpenRouter pilot smoke runbook

This runbook is for the credentialed pilot smoke test. Do not run it against
production participants or place credentials in tracked files, browser
variables, logs, fixtures, issue comments, or screenshots.

## Configure the private environment

1. Start local Supabase and generate `apps/web/.env.local` with `corepack pnpm env:local`
   if it does not already exist.
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
   Run queued work with `corepack pnpm api:worker`.
6. Expose FastAPI through an HTTPS tunnel. Configure Meta's callback as
   `https://<tunnel-host>/webhooks/whatsapp`, subscription field `messages`.

The application accesses every provider secret only in server route handlers
and server-only provider configuration. `whatsapp-media` is a private storage
bucket; source media can only be signed for an active operator for at most five
minutes through `/api/operator/channel-media/<asset-id>`.

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

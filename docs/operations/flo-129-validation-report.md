# FLO-129 FastAPI provider validation report

Date: 2026-09-16

## Status

**Not ready to close.** Repository, database, API contract, and browser
regressions pass. Public webhook verification, signature verification,
persistence, transport idempotency, and a real Meta outbound delivery are
proven. Closure still requires credential-rotation evidence, a live Meta
inbound text/button/voice exercise, and an OpenRouter TLS-capable environment.

## Capability matrix

| Capability                                        | FastAPI implementation                                                                                                                    | Persisted data contract                                                              | Test/evidence                                                                                  | Live proof                                                                                    | Duplicate old path?               | Result                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| Meta verification challenge                       | [webhook router](../../apps/api/app/api/whatsapp.py)                                                                                      | None                                                                                 | `api:test`: configured token `200`; invalid token `403`                                        | Correct token `200` with raw challenge; invalid token `403`                                   | No                                | PASS                                                        |
| `X-Hub-Signature-256` verification                | [webhook router](../../apps/api/app/api/whatsapp.py), [Meta adapter](../../apps/api/app/integrations/whatsapp.py)                         | Raw payload retained in `channel_events`                                             | `test_whatsapp.py` rejects an invalid HMAC                                                     | Signed probe `200`; invalid signature `401`                                                   | No                                | PASS                                                        |
| Inbound parsing and raw event persistence         | [webhook router](../../apps/api/app/api/whatsapp.py)                                                                                      | `channel_events`                                                                     | `test_whatsapp.py` signed inbound fixture                                                      | Synthetic signed text retained one event and one durable job                                  | No                                | PASS (Meta sender pending)                                  |
| Provider event/message deduplication              | [inbound persistence](../../apps/api/app/api/whatsapp.py)                                                                                 | Inbound-message unique key plus `channel, provider_event_id` event key               | API replay test; [database test](../../tests/integration/database.test.ts)                     | Inbound replay `200`; signed status replay `200`                                              | No                                | PASS                                                        |
| Text and interactive input                        | [normalizer](../../apps/api/app/integrations/whatsapp.py), [worker](../../apps/api/app/workers/whatsapp.py)                               | `channel_events.payload`, `proposed_actions.interpretation`                          | Text and button-reply tests                                                                    | Synthetic text proven; Meta text/button remains to be exercised                               | No                                | PASS (live Meta exercise pending)                           |
| Media metadata and voice-note path                | [normalizer](../../apps/api/app/integrations/whatsapp.py), [worker](../../apps/api/app/workers/whatsapp.py)                               | `channel_media_assets`, private `whatsapp-media` bucket                              | No-text audio worker test; database privacy test                                               | Public endpoint is ready; real Meta voice note pending                                        | No                                | PASS (live Meta exercise pending)                           |
| Meta media retrieval                              | [Meta adapter](../../apps/api/app/integrations/whatsapp.py)                                                                               | Private storage path/retrieval state                                                 | Mocked no-text worker retrieval path                                                           | Requires a real Meta voice media ID                                                           | No                                | PASS (live Meta exercise pending)                           |
| Transcript and transcription evidence             | [worker](../../apps/api/app/workers/whatsapp.py), [OpenRouter adapter](../../apps/api/app/integrations/language.py)                       | Transcript, confidence, provider, model, latency, metadata on `channel_media_assets` | Mocked no-text worker transcription/provenance test                                            | OpenRouter TLS fails in this environment                                                      | No                                | ENVIRONMENT-BLOCKED                                         |
| Language detection                                | [language adapter](../../apps/api/app/integrations/language.py)                                                                           | Language/confidence on event and interpretation                                      | Heuristic implementation inspected                                                             | Public endpoint is ready; live voice proof is pending                                         | No                                | PASS (live Meta exercise pending)                           |
| English, Afrikaans, isiXhosa, code-switched input | [language rules](../../apps/api/app/integrations/language.py)                                                                             | Draft ambiguity and language evidence                                                | Focused FastAPI tests exercise English, Afrikaans, isiXhosa, and ambiguous code-switched input | Live voice proof is pending                                                                   | No                                | PASS (live Meta exercise pending)                           |
| OpenRouter structured intent                      | [OpenRouter adapter](../../apps/api/app/integrations/language.py)                                                                         | `proposed_actions` provider/model/latency/cost interpretation evidence               | Mocked fallback/schema test passes                                                             | DNS/TCP pass; Windows Schannel TLS fails before authenticated request                         | No                                | ENVIRONMENT-BLOCKED                                         |
| Structured schema validation                      | [OpenRouter parser](../../apps/api/app/integrations/language.py), [worker validation](../../apps/api/app/workers/whatsapp.py)             | Validated draft payload only                                                         | Mocked structured-output test passes                                                           | Not independently live-proven                                                                 | No                                | PASS                                                        |
| ProposedAction review boundary                    | [FastAPI review routes](../../apps/api/app/api/v1/proposed_actions.py)                                                                    | `proposed_actions`, command execution, domain event, outbox                          | Draft-only worker test; operator/RLS integration tests                                         | Not dependent on provider delivery                                                            | No                                | PASS                                                        |
| Ops Inbox provenance continuity                   | [Inbox query](../../apps/web/src/features/ops-inbox/queries.ts)                                                                           | Event, transcript, confidence, media relationship                                    | Typecheck/build and database provenance tests                                                  | No live draft available                                                                       | Retained frontend read model only | PASS                                                        |
| Outbound text and provider ID                     | [delivery worker](../../apps/api/app/workers/whatsapp.py), [Meta adapter](../../apps/api/app/integrations/whatsapp.py)                    | `channel_deliveries.provider_message_id`                                             | Provider retry test; database delivery test; bad internal token `401`                          | Real Meta send persisted provider ID and reached `delivered`                                  | No                                | PASS                                                        |
| Template sending                                  | [Meta adapter](../../apps/api/app/integrations/whatsapp.py)                                                                               | Provider ID can use `channel_deliveries`                                             | Concrete `send_template` implementation inspected                                              | No approved product template is currently configured or required                              | No                                | PASS (implemented; no current product flow)                 |
| Sent/delivered/read/failed evidence               | [status normalizer](../../apps/api/app/integrations/whatsapp.py), [webhook router](../../apps/api/app/api/whatsapp.py)                    | Raw status `channel_events`; normalized `channel_deliveries` lifecycle               | Status-ID API regression; status coexistence database test; read/failed/retry tests            | Real Meta send reached `delivered`; signed callback/replay correlated one status evidence row | No                                | PASS                                                        |
| Durable jobs and recovery                         | [worker](../../apps/api/app/workers/whatsapp.py), [migration](../../supabase/migrations/20260915130000_flo_129_provider_integrations.sql) | Processing/delivery leases, attempts, retry time, failure reason                     | Database retry plus processing and delivery lease recovery tests                               | Not externally required                                                                       | No                                | PASS                                                        |
| Outbox/domain-before-message ordering             | [dispatcher](../../apps/api/app/application/dispatcher.py)                                                                                | `private.domain_events` before `private.outbox_messages`                             | Source audit; integration suite passes                                                         | Not externally required                                                                       | No                                | PASS                                                        |
| Provider configuration and secrets                | [settings](../../apps/api/app/core/config.py), [.env.example](../../.env.example)                                                         | Ignored `.env` or `apps/api/.env` only                                               | Resolved presence check; provider fields are server-only                                       | Runtime configuration present                                                                 | No                                | FAIL: supplied credentials are exposed and require rotation |
| OpenAPI synchronization                           | [FastAPI app](../../apps/api/app/main.py), [export script](../../apps/api/scripts/export_openapi.py), [contract](../openapi.yaml)         | Canonical `docs/openapi.yaml`                                                        | `api:openapi:check` passed with no semantic diff                                               | Not externally required                                                                       | No                                | PASS                                                        |
| No model-driven canonical mutation                | [message worker](../../apps/api/app/workers/whatsapp.py), [review route](../../apps/api/app/api/v1/proposed_actions.py)                   | Pending `proposed_actions`; FastAPI command event/outbox                             | Draft-only worker test and RLS integration suite                                               | Not externally required                                                                       | No                                | PASS                                                        |

`read` is preserved in the raw provider status event and normalized to the
terminal `delivered` lifecycle state; no read receipt is discarded.

## Architecture audit

FastAPI is the sole executable backend for WhatsApp, OpenRouter, transcription,
webhook ingestion, and provider delivery orchestration. The audited
TypeScript/TSX source has no Meta/OpenRouter/transcription client, direct
provider fetch, webhook route, processor, or delivery worker. The only
Supabase function file is `.gitkeep`.

The retained Web code is a read-only Ops Inbox projection and authorized
private-media proxy; shared packages are contracts/types. The superseded Next.js
webhook, provider, and processor paths were removed by FLO-132, as recorded in
[the migration matrix](flo-132-fastapi-provider-migration.md).

Browser clients cannot invoke consequential RPCs directly: the FLO-131
[migration](../../supabase/migrations/20260916000000_flo_131_fastapi_command_boundary.sql)
revokes command RPCs from `anon` and `authenticated`; FastAPI establishes the
server-derived actor context and creates command, domain-event, and outbox rows
in one transaction. The database suite proves browser direct command denial,
provenance preservation, private-media authorization, job deduplication, and
delivery retry/recovery.

## Automated verification

| Command                                            | Result                                          |
| -------------------------------------------------- | ----------------------------------------------- |
| `corepack pnpm api:test`                           | PASS: 13 tests                                  |
| `corepack pnpm api:lint`                           | PASS                                            |
| `corepack pnpm test:integration`                   | PASS: 22 tests                                  |
| `corepack pnpm exec supabase migration up --local` | PASS: FLO-129 status-evidence migration applied |
| `corepack pnpm api:typecheck`                      | PASS: 28 files                                  |
| `corepack pnpm api:openapi:check`                  | PASS: generated contract has no semantic diff   |
| `corepack pnpm lint`                               | PASS                                            |
| `corepack pnpm typecheck`                          | PASS                                            |
| `corepack pnpm test`                               | PASS: 46 unit/integration tests                 |
| `corepack pnpm build`                              | PASS                                            |
| `corepack pnpm test:e2e`                           | PASS: 20 Playwright tests                       |

## Live evidence and blockers

The subscribed public callback
`https://markd.planed.co.za/webhooks/whatsapp` now reaches FastAPI. A
correct-token GET returned `200` with the raw `markd-test` challenge and an
invalid-token GET returned `403`. A signed, non-PII synthetic text probe
returned `200` in `1219 ms`; its replay also returned `200`, while an invalid
signature returned `401`. The local canonical database contained exactly one
ChannelEvent and one durable processing job after replay. This proves the public
ingress boundary, but does not replace a message sent by Meta's test number.

Provider variables are present for the webhook verify token, Meta app
secret/access token/phone number ID, OpenRouter API key, and
`SUPABASE_DB_URL` in `apps/api/.env`. Graph API version is `v24.0`; WABA ID is
not consumed by this implementation. `INTERNAL_SERVICE_TOKEN` is configured
and an invalid-token probe returned `401`. A valid test recipient passed the
server-side E.164 check, and a real Meta validation send persisted a provider
message ID and reached `delivered` after one attempt. The FastAPI runner
disables Uvicorn access logs so verify-token query values are not emitted.

The original delivered-status evidence exposed a data-contract defect: the
event-level derived status ID had been stored in `provider_message_id`, rather
than Meta's actual message ID. The append-only `channel_events` policy correctly
rejected a historical backfill, so existing raw evidence is unchanged. The
applied FLO-129 migration narrows provider-message uniqueness to inbound
messages, preserving status-event dedupe through `provider_event_id`. New
status evidence now stores the actual provider message ID. A signed status
callback and its replay both returned `200`; the canonical database contains
one new indexed status row correlated to the real delivery without exposing its
identifier.

`openrouter.ai` DNS resolution and TCP port `443` were successful. An
unauthenticated request through the adapter's `httpx` stack fails before HTTP
with `ConnectError`, rooted in `SSLV3_ALERT_HANDSHAKE_FAILURE`. No credentialed
request was attempted. The existing `api:test:providers` script calls provider
adapters directly; it cannot replace webhook, durable-job, persistence, and
status-callback proof. This is an environment blocker, not an application-code
failure.

## Required remediation and rerun

1. **P0 security:** rotate every credential published in the FLO-129 comment:
   Supabase service-role credential, Meta app secret/access token, OpenRouter
   API key, and webhook token. Remove or redact the comment, then place new
   values only in ignored `.env` or `apps/api/.env` and the deployed FastAPI
   secret store.
2. **P1 inbound live proof:** after rotation, use an unrestricted network to
   send a Meta test text, button reply, and voice note to the restored callback;
   confirm the signed webhook persists one event/job, run the FastAPI worker,
   and retain the resulting draft/transcript/provider metadata. Replay the
   inbound payloads to prove that no duplicate event or draft is created.
   Outbound delivery and signed status callback/replay correlation now pass.
3. **P1 adapter smoke:** resolve the OpenRouter TLS handshake failure, then,
   after the end-to-end run identifies the Meta media ID,
   run
   `corepack pnpm api:test:providers -- --confirm-live --recipient <E.164> --voice-media-id <Meta-media-ID>`
   on the unrestricted network. This validates the concrete adapters only.
   Retain only provider IDs, timestamps, model, latency, cost, and status
   evidence; do not retain payloads, media URLs, phone numbers, or secrets.

FLO-129 must remain open until the P0 rotation and P1 live checks succeed.

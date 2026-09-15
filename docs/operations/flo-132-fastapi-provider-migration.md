# FLO-132 FastAPI provider migration matrix

FastAPI is the only production execution boundary for provider calls, webhook
ingestion, and queued background work. Supabase remains the canonical data,
Auth, Storage, Realtime, and durable queue platform.

| Capability                         | Existing implementation path(s)               | FastAPI target                                         | Data contract reused                                               | Test/evidence                                       | Old path removal                                 |
| ---------------------------------- | --------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------ |
| Meta webhook verification/ingest   | Next.js webhook route                         | `app.api.whatsapp` `GET`/`POST /webhooks/whatsapp`     | `channel_events`                                                   | `test_whatsapp.py` challenge/signature/replay tests | Next.js webhook deleted                          |
| ChannelEvent persistence/dedupe    | Next.js webhook route                         | FastAPI webhook transaction                            | `channel_events` unique provider message ID and processing trigger | replay test                                         | Next.js route deleted                            |
| WhatsApp media retrieval           | Next.js processor and provider adapter        | `app.workers.whatsapp` and `app.integrations.whatsapp` | `channel_media_assets`, private `whatsapp-media` storage           | deterministic worker path; live smoke runbook       | Next.js route/adapter deleted                    |
| Transcription/language             | Next.js processor and language provider       | `app.integrations.language` worker pipeline            | media transcript columns and `interpretation` evidence             | deterministic worker test; live smoke runbook       | TypeScript provider implementation/tests deleted |
| OpenRouter structured intent       | Next.js processor and language provider       | `OpenRouterProvider.extract_intent`                    | `proposed_actions` evidence fields                                 | draft-only worker test; live smoke runbook          | TypeScript provider implementation/tests deleted |
| ProposedAction validation/creation | Next.js processor                             | FastAPI worker creates only validated pending drafts   | existing `proposed_actions` and FLO-131 command boundary           | worker test excludes canonical mutations            | Next.js processor deleted                        |
| Outbound WhatsApp                  | Next.js delivery route and provider adapter   | FastAPI internal delivery queue plus worker            | `channel_deliveries`                                               | worker/provider smoke runbook                       | Next.js delivery route/adapter deleted           |
| Delivery/read/failure statuses     | Next.js webhook route                         | FastAPI webhook status normalization                   | `channel_events`, `record_channel_delivery_status`                 | read-status replay test                             | Next.js webhook deleted                          |
| Background jobs/retries            | Next.js process/delivery routes               | `apps/api/run.py worker` and worker module             | existing claim/complete/requeue queue RPCs                         | FastAPI worker tests and live retry runbook         | Next.js job routes deleted                       |
| Provider configuration/secrets     | Next.js provider factory and web smoke script | `Settings` and FastAPI-only smoke script               | server-only environment contract                                   | `.env.example` and runbook                          | web provider factory/smoke script deleted        |

The retained `packages/language` and `packages/messaging` modules contain
shared contracts and deterministic client-neutral copy only. They cannot make
provider calls, write canonical state, or execute background jobs.

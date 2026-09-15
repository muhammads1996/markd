# Application API & Command Contract v1 — MARKD

# MARKD Application API & Command Contract v1

## Purpose

This is the canonical application-boundary contract for the MARKD pilot. Implementation tickets must consume or implement these contracts rather than inventing ticket-local mutation APIs.

The contract is intentionally **domain-command oriented**, not CRUD over database tables.

## Architecture boundary

```text
Participant Next.js PWA / Ops UI
        │
        ├── Supabase Auth
        ├── authorised Supabase read projections / Realtime where appropriate
        │
        └── FastAPI /api/v1 for consequential commands

Meta WhatsApp
        │
        └── FastAPI /webhooks/whatsapp
                 │
                 ├── ChannelEvent persistence + transport idempotency
                 ├── background media/transcription/intent jobs
                 └── validated intent -> SAME application commands

FastAPI application layer
        │
        ├── authorisation/policy
        ├── command idempotency
        ├── canonical state transitions
        ├── audit/provenance
        ├── domain event/outbox creation
        └── Supabase PostgreSQL / Storage

Supabase remains the canonical datastore. FastAPI is not a second source of truth.
```

### Core rule

A PWA action, Ops action and validated WhatsApp action that mean the same thing must resolve to the **same command handler and state-transition rules**.

Transport adapters may normalise input, but they do not own business lifecycle state.

---

# 1. API conventions

## Base paths

Application API:

```text
/api/v1
```

Provider webhook:

```text
/webhooks/whatsapp
```

Health:

```text
/health/live
/health/ready
```

## Authentication

### `GET /api/v1/me`

Return the server-resolved authenticated application identity/context used by PWA/Ops clients.

```json
{
  "auth_user_id": "uuid",
  "person_id": "uuid|null",
  "actor_kind": "worker|hirer|contractor|operator",
  "participant_scopes": ["worker", "contractor"],
  "organisation_contacts": [
    { "organisation_contact_id": "uuid", "organisation_id": "uuid" }
  ]
}
```

The response is derived from canonical auth mappings. Client input never grants a role or scope.

### Participant / Ops requests

Use:

```http
Authorization: Bearer <Supabase access token>
```

FastAPI verifies the token and derives the authenticated actor server-side.

Never trust client-supplied `actor_id`, role, organisation membership or operator privilege.

### WhatsApp webhook

Meta webhook verification/signature validation is independent from participant authentication.

A validated WhatsApp actor is resolved from canonical contact/channel identity before a domain command is permitted.

## Required request headers for commands

```http
Authorization: Bearer ...          # except provider/internal entry points
Idempotency-Key: <uuid/string>
X-Correlation-Id: <optional uuid>
```

`Idempotency-Key` is mandatory for consequential client-originated commands.

### Idempotency semantics

Persist, at minimum:

- idempotency key
- command type
- authenticated/resolved actor
- target aggregate/resource
- canonical hash of command payload
- result reference
- timestamp

Rules:

1. same key + same command/payload -> return the original result;
2. same key + different payload -> `409 IDEMPOTENCY_KEY_REUSE`;
3. a semantically repeated command with a different transport key must still be safe at the domain layer;
4. Meta provider message-id deduplication is **transport idempotency** and remains separate from application-command idempotency.

Recommended WhatsApp-derived command key:

```text
wa:<provider_message_id>:<normalised_command>
```

PWA/Ops clients generate their own UUID idempotency key.

## Optimistic state protection

State-changing commands may include:

```json
{
  "expected_version": 7
}
```

If supplied and stale, return `409 STALE_VERSION` with current version metadata. Commands that are naturally idempotent may return the current applied state instead where safe.

## Standard command result

```json
{
  "command_id": "uuid",
  "status": "applied",
  "resource": {
    "type": "assignment",
    "id": "uuid",
    "version": 8
  },
  "occurred_at": "2026-09-15T18:30:00Z",
  "effects": {
    "outbound_messages_queued": 1
  }
}
```

`status` values:

```text
applied
already_applied
accepted_for_review
```

## Errors

Use a stable problem response:

```json
{
  "type": "https://api.markd/errors/invalid-state",
  "title": "Invalid state transition",
  "status": 409,
  "code": "INVALID_STATE",
  "detail": "Travel cannot be authorised until worker acceptance, contractor confirmation and logistics are complete.",
  "correlation_id": "uuid",
  "current_version": 4
}
```

Stable codes must include at least:

```text
VALIDATION_ERROR
UNAUTHENTICATED
FORBIDDEN
NOT_FOUND
INVALID_STATE
STALE_VERSION
IDEMPOTENCY_KEY_REUSE
REVIEW_REQUIRED
CONFLICTING_RESPONSE
RATE_LIMITED
PROVIDER_UNAVAILABLE
```

Do not leak provider secrets, stack traces or private worker information in errors.

---

# 2. Shared provenance contract

Every consequential mutation records server-derived provenance.

Conceptual shape:

```json
{
  "actor": {
    "kind": "worker|hirer|contractor|operator|system",
    "person_id": "uuid|null",
    "organisation_contact_id": "uuid|null"
  },
  "source": {
    "channel": "pwa|ops|whatsapp|system",
    "command_id": "uuid",
    "channel_event_id": "uuid|null",
    "provider_message_id": "string|null"
  },
  "recorded_at": "timestamp"
}
```

The browser does not get to assert this structure as trusted fact. Transport/application middleware derives it.

When an operator records facts stated by another person, preserve both:

- `recorded_by` — the operator;
- `asserted_by` — worker/contractor/source person where known.

---

# 3. Canonical Assignment model

Do not compress all assignment meaning into one oversized status enum.

The canonical assignment should preserve orthogonal facts:

```text
lifecycle:
  active | completed | cancelled | no_show

worker_response:
  pending | call_me | accepted | declined

contractor_confirmation:
  pending | confirmed | rejected

travel:
  travel_authorised_at nullable
  travel_revoked_at nullable

logistics:
  reporting_mode: site | pickup
  place_text
  reporting_at
  optional reusable pickup_point_id
  optional location pin
  optional landmark/instructions
  optional contractor/site contact
```

### Worker-facing derived states

These are projections, not separate business state machines.

**OFFER — DO NOT TRAVEL YET**

Assignment active + offered + no accepted response.

**ACCEPTED — WAITING FOR CONFIRMATION — DO NOT TRAVEL YET**

`worker_response=accepted` and `travel_authorised_at=null`.

**WORK CONFIRMED / CONFIRMED — GO**

Only when `travel_authorised_at` is non-null and assignment remains active.

### Travel-ready predicate

`AuthoriseAssignmentTravel` may succeed only when all required policy is true, including:

- assignment active;
- worker accepted;
- contractor confirmed;
- essential reporting logistics complete;
- no blocking exception/cancellation condition.

The command sets `travel_authorised_at` transactionally. UI colour, WhatsApp delivery or push notification can never create travel readiness.

---

# 4. Labour Request commands — [FLO-112](https://linear.app/flowtation/issue/FLO-112/build-labour-request-and-assignment-workflow)

### Hirer/requester model

Do not hard-code the product contract to registered contracting companies only. A Labour Request may be initiated by an authorised contractor/builder organisation **or an individual hirer/homeowner**.

The business contract represents a canonical requester/hirer reference. If the pilot database maps all hirers through `Organisation` + `OrganisationContact`, that is an acceptable implementation detail; the API must not prevent an individual-hirer representation later.

Where the request is organisation-backed, `contractor_organisation_id` / `contractor_contact_id` apply. Where an individual-hirer mapping exists, resolve it server-side to the canonical Person/account allowed by policy.

## `POST /api/v1/labour-requests`

Command: `CreateLabourRequest`

Authorised actors: Ops; authorised contractor contact for its own organisation.

Body:

```json
{
  "contractor_organisation_id": "uuid",
  "contractor_contact_id": "uuid|null",
  "work_date": "2026-09-18",
  "start_time": "07:30",
  "timezone": "Africa/Johannesburg",
  "site_area": "Woodstock, Cape Town",
  "site_text": "optional plain-language site",
  "pay": {
    "amount_minor": 45000,
    "currency": "ZAR",
    "basis": "daily",
    "terms_text": "Paid at end of day"
  },
  "notes": "optional",
  "requirements": [
    {
      "work_type": "painter",
      "headcount": 2,
      "notes": "interior prep and paint"
    }
  ]
}
```

No automated ranking is created by this command.

## `PATCH /api/v1/labour-requests/{labour_request_id}`

Command: `UpdateLabourRequest`

Allowed only while policy permits changes. Audit the previous values.

Do not silently alter already travel-authorised assignments when request facts change; route consequential changes through explicit assignment update/cancellation policy.

## `POST /api/v1/labour-requests/{labour_request_id}/cancel`

Command: `CancelLabourRequest`

Body:

```json
{
  "reason": "string",
  "expected_version": 4
}
```

Cancellation must fan out through explicit assignment cancellation policy rather than deleting history.

## `POST /api/v1/labour-requests/{labour_request_id}/assignments`

Command: `CreateAssignments`

Authorised actors: Ops or authorised contractor contact.

Body:

```json
{
  "requirement_id": "uuid",
  "worker_ids": ["uuid", "uuid"],
  "expected_version": 4
}
```

Returns created/existing assignment references. Repeated worker selection must not create duplicates for the same request/requirement where uniqueness policy forbids it.

## `POST /api/v1/assignments/{assignment_id}/offer`

Command: `OfferAssignment`

Commits the offer fact first, then creates an outbound-message job/event. Provider delivery is not the domain transaction.

The worker-facing copy/template is owned by [FLO-124](https://linear.app/flowtation/issue/FLO-124/build-accessible-worker-offer-and-confirmation-messaging).

## `POST /api/v1/assignments/{assignment_id}/respond`

Command: `RespondToAssignment`

Body:

```json
{
  "response": "accepted|declined|call_me",
  "expected_version": 2
}
```

PWA mapping:

```text
TAKE JOB -> accepted
CAN'T GO -> declined
```

WhatsApp mapping:

```text
YES / 1 -> accepted
NO / 2 -> declined
CALL ME / 3 -> call_me
```

Rules:

- repeated same response -> `already_applied`;
- `call_me` may later become accepted/declined;
- a contradictory terminal response after acceptance/decline must not silently overwrite provenance;
- after acceptance, a later inability to attend should use the explicit cancellation/withdrawal command rather than pretending the original offer response never existed.

## `POST /api/v1/assignments/{assignment_id}/contractor-confirm`

Command: `ConfirmAssignmentByContractor`

Body:

```json
{
  "confirmed": true,
  "expected_version": 3
}
```

This is separate from worker acceptance.

## `POST /api/v1/assignments/{assignment_id}/cancel`

Command: `CancelAssignment`

Body:

```json
{
  "reason_code": "worker_withdrew|contractor_cancelled|job_cancelled|operator_cancelled|other",
  "reason_text": "optional",
  "expected_version": 5
}
```

If cancellation occurs after `travel_authorised_at`, persist that fact explicitly for travel-impact metrics/exception handling.

---

# 5. Worker availability command — [FLO-130](https://linear.app/flowtation/issue/FLO-130/wire-participant-pwa-commands-to-canonical-state-and-whatsapp) / fulfilment support

## `PUT /api/v1/workers/{worker_id}/availability/{date}`

Command: `SetWorkerAvailability`

Body:

```json
{
  "status": "available|unavailable|unknown",
  "note": "optional",
  "expected_version": 1
}
```

A worker may update self. Ops may record availability with provenance. Contractor access is read/policy constrained and must not become permission to edit worker availability.

---

# 6. Logistics and travel commands — [FLO-125](https://linear.app/flowtation/issue/FLO-125/build-travel-ready-assignment-and-pickup-coordination-flow)

## `PUT /api/v1/assignments/{assignment_id}/logistics`

Command: `SetAssignmentLogistics`

Body:

```json
{
  "reporting_mode": "site|pickup",
  "place_text": "Main Road opposite the library",
  "reporting_at": "2026-09-18T07:00:00+02:00",
  "pickup_point_id": "uuid|null",
  "location_pin": {
    "lat": -33.0,
    "lng": 18.0
  },
  "landmark": "Opposite the library",
  "instructions": "Ask for Yusuf at the gate",
  "contact": {
    "name": "Yusuf",
    "phone": "+27..."
  },
  "expected_version": 4
}
```

`location_pin`, landmark and contact are optional. Do not require worker home location or route tracking.

## `POST /api/v1/assignments/{assignment_id}/authorise-travel`

Command: `AuthoriseAssignmentTravel`

Body:

```json
{
  "expected_version": 5
}
```

Server evaluates the travel-ready predicate. On success:

1. set `travel_authorised_at` transactionally;
2. emit `assignment.travel_authorised`;
3. queue the approved `CONFIRMED — GO` communication after commit.

Repeated execution after success is `already_applied`.

## `POST /api/v1/assignments/{assignment_id}/acknowledgements`

Command: `RecordAssignmentAcknowledgement`

Pilot-supported kind:

```json
{
  "kind": "on_my_way"
}
```

This is operational evidence only. It must not become a required assignment state or trigger live GPS tracking.

---

# 7. Stamp / Workmark commands — [FLO-114](https://linear.app/flowtation/issue/FLO-114/close-completed-assignments-into-provenance-aware-workmarks)

## `POST /api/v1/assignments/{assignment_id}/stamps`

Command: `SubmitAssignmentStamp`

Authorised actors: assigned worker, authorised contractor contact, Ops capture/policy.

Body:

```json
{
  "attendance": "attended|no_show|unknown",
  "completion": "completed|partial|not_completed|unknown",
  "reuse_preference": "yes|no|unknown",
  "payment": {
    "state": "unknown|pending|paid|partial|disputed",
    "amount_minor": 45000,
    "currency": "ZAR",
    "method": "cash|eft|other|unknown"
  },
  "note": "optional",
  "expected_version": 7
}
```

For operator capture, an authorised internal variation may additionally record `asserted_by` / source evidence. Participant clients may not spoof another actor.

Transaction rule:

- persist the Stamp and its provenance;
- create or update the assignment's canonical Workmark in the same authoritative application transaction/policy;
- unanswered facts remain explicitly unknown/pending;
- never increment Work Card counts before the committed Workmark exists.

### Assignment closeout effect

`SubmitAssignmentStamp` also evaluates Assignment closeout policy. Where authoritative evidence is sufficient, the same application transaction/policy may transition `lifecycle` to `completed` or `no_show` and emit the corresponding Assignment outcome event before/alongside Workmark events.

Do not create a second client-only `CloseAssignment` state machine. If evidence is insufficient or disputed, preserve pending/exception state rather than manufacturing completion.

## `POST /api/v1/workmarks/{workmark_id}/corrections`

Command: `CorrectWorkmark`

Body:

```json
{
  "reason": "string",
  "changes": {
    "payment_state": "paid"
  },
  "expected_version": 3
}
```

Corrections append audit/provenance. They do not erase historical assertions.

---

# 8. Exception commands — [FLO-115](https://linear.app/flowtation/issue/FLO-115/build-exceptions-workflow-for-unpaid-disputed-and-failed-work)

## `POST /api/v1/assignments/{assignment_id}/exceptions`

Command: `OpenAssignmentException`

Body:

```json
{
  "type": "unpaid|disputed|no_show|contractor_cancelled|completion_dispute|verification_concern|other",
  "summary": "string"
}
```

Opening an exception is not automatically a trusted Work Graph fact.

## `POST /api/v1/exceptions/{exception_id}/claims`

Command: `AddExceptionClaim`

Preserve claimant identity, source and evidence separately from counterclaims.

## `POST /api/v1/exceptions/{exception_id}/resolve`

Command: `ResolveAssignmentException`

Ops/policy-controlled. Resolution preserves the original claims and adds resolution provenance.

---

# 9. ProposedAction bridge — existing WhatsApp/Ops pipeline

AI/provider output never invokes arbitrary database writes.

A validated ProposedAction must resolve to an allow-listed application command.

## `POST /api/v1/proposed-actions/{proposed_action_id}/confirm`

Command: `ConfirmProposedAction`

Ops confirms a ProposedAction. The application maps its validated intent/payload to one of the registered commands above and executes through the same policy/idempotency layer.

## `POST /api/v1/proposed-actions/{proposed_action_id}/reject`

Command: `RejectProposedAction`

No graph mutation beyond rejection/audit evidence.

Straight-through WhatsApp execution introduced later may bypass manual confirmation only for explicitly allow-listed deterministic low-risk intents and still invokes the same registered command handler.

---

# 10. WhatsApp provider boundary — [FLO-129](https://linear.app/flowtation/issue/FLO-129/complete-live-whatsapp-transcription-and-openrouter-provider) source / [FLO-132](https://linear.app/flowtation/issue/FLO-132/migrate-implemented-flo-129-whatsapp-and-ai-provider-path-onto-fastapi) target

## `GET /webhooks/whatsapp`

Meta challenge verification.

## `POST /webhooks/whatsapp`

Responsibilities of synchronous webhook handler:

1. verify provider signature;
2. parse only the minimum provider envelope required for safe persistence;
3. idempotently persist ChannelEvent/provider status evidence;
4. enqueue background processing where required;
5. return provider acknowledgement quickly.

Do **not** call transcription/OpenRouter synchronously in the webhook request.

### Background job types

At minimum:

```text
whatsapp.media.retrieve
transcription.run
language.detect
intent.extract
proposed_action.validate
whatsapp.outbound.send
whatsapp.outbound.retry
```

Jobs are retry-safe and preserve correlation/provenance.

### Outbound rule

Business transition first:

```text
command transaction commits
    -> domain event/outbox record
    -> outbound WhatsApp job
    -> Meta API
    -> provider message ID/status evidence
```

A provider failure does not roll back a successful canonical domain transition. Critical delivery failure becomes visible to Ops.

---

# 11. Domain events / outbox

Use durable event/outbox semantics for side effects that must occur after a successful state transition.

Minimum event vocabulary:

```text
labour_request.created
labour_request.updated
labour_request.cancelled
assignment.created
assignment.offered
assignment.worker_responded
assignment.contractor_confirmed
assignment.logistics_updated
assignment.travel_authorised
assignment.acknowledged
assignment.cancelled
assignment.completed
workmark.created
workmark.updated
workmark.corrected
exception.opened
exception.resolved
```

Each event includes aggregate id/version, command id, actor/source provenance and occurred-at timestamp.

[FLO-119](https://linear.app/flowtation/issue/FLO-119/instrument-pilot-metrics-and-worker-day-economics) metrics should derive from canonical records/events rather than UI analytics.

---

# 12. Read-model boundary

The pilot does **not** require every authorised read to route through FastAPI.

Supabase RLS-backed views/projections may continue to serve PWA/Ops reads and Realtime where safe. However, read models must use canonical facts and stable schemas.

Required projections for remaining tickets include:

```text
Participant worker Work/Home assignment projection
Contractor LabourRequest/crew-readiness projection
Tomorrow operations projection
Work Card projection
Contractor labour-book / relationship projection
Workmark history projection
Exception queue projection
Pilot metrics projection
```

No read model may invent client-only lifecycle state.

If a read later needs server composition or public/revocable access, expose it under `/api/v1` without changing the underlying domain meaning.

---

# 13. Cross-channel convergence rules — [FLO-130](https://linear.app/flowtation/issue/FLO-130/wire-participant-pwa-commands-to-canonical-state-and-whatsapp)

1. PWA, Ops and validated WhatsApp commands call the same registered application command handler.
2. ChannelEvent/provider-message dedupe and command idempotency remain separate layers.
3. Same semantic command repeated after it is already true returns `already_applied`.
4. Contradictory historical responses are not silently overwritten.
5. `RespondToAssignment(accepted)` followed by a worker needing to withdraw uses `CancelAssignment`; it does not erase the acceptance.
6. Domain commit occurs before outbound acknowledgement/confirmation is queued.
7. PWA/Realtime reads canonical persisted state; it never trusts a local success toast as proof.
8. WhatsApp messages use the same typed deterministic facts/copy keys as the PWA presentation contract.
9. Provider delivery status is evidence about communication, not domain-state truth.

---

# 14. Command registry / implementation rule

FastAPI should expose a central application command registry/service boundary conceptually equivalent to:

```text
CommandContext
- authenticated/resolved actor
- channel/source provenance
- idempotency key
- correlation id
- occurred/requested timestamp

CommandHandler<TCommand, TResult>
- authorise
- validate current aggregate state
- apply transaction
- append audit/domain event
- return canonical result
```

Routers, WhatsApp adapters and AI adapters must remain thin.

Do not duplicate the same state-transition logic in:

- Next.js server actions;
- a WhatsApp processor;
- FastAPI routers;
- database triggers;
- provider adapters.

One authoritative handler/policy owns each transition.

---

# 15. Contract implementation / OpenAPI

The implemented FastAPI project must generate OpenAPI from typed request/response models.

Repository expectations once [FLO-131](https://linear.app/flowtation/issue/FLO-131/introduce-fastapi-backend-boundary-for-commands-integrations-and-ai) is implemented:

```text
apps/api/
  app/
    main.py
    api/v1/
    application/
    domain/
    integrations/
    workers/
  tests/
```

CI should be able to export the OpenAPI schema so client generation/contract tests can detect breaking changes.

Breaking changes to the command contract require an intentional version/change decision; ticket-local convenience changes must not silently change API semantics.

---

# 16. Ticket ownership mapping

[FLO-131](https://linear.app/flowtation/issue/FLO-131/introduce-fastapi-backend-boundary-for-commands-integrations-and-ai) — implement FastAPI foundation and shared API mechanics: auth context, errors, idempotency infrastructure, command routing/registry, transaction/outbox/job foundation, health/config/observability. It consumes this design; it does not redefine it.

[FLO-132](https://linear.app/flowtation/issue/FLO-132/migrate-implemented-flo-129-whatsapp-and-ai-provider-path-onto-fastapi) — port the useful unmerged [FLO-129](https://linear.app/flowtation/issue/FLO-129/complete-live-whatsapp-transcription-and-openrouter-provider) provider implementation directly into the FastAPI provider/job boundary, preserving ChannelEvent/ProposedAction/provider evidence. Do not first merge the old execution path merely to migrate it later.

[FLO-112](https://linear.app/flowtation/issue/FLO-112/build-labour-request-and-assignment-workflow) — implement LabourRequest/Assignment commands and canonical assignment facts.

[FLO-124](https://linear.app/flowtation/issue/FLO-124/build-accessible-worker-offer-and-confirmation-messaging) — implement worker-facing offer/accepted/confirmed templates and interaction semantics on top of `OfferAssignment`, `RespondToAssignment` and travel-authorised events. No separate business API.

[FLO-125](https://linear.app/flowtation/issue/FLO-125/build-travel-ready-assignment-and-pickup-coordination-flow) — implement logistics + `AuthoriseAssignmentTravel` + travel-impact cancellation behaviour.

[FLO-114](https://linear.app/flowtation/issue/FLO-114/close-completed-assignments-into-provenance-aware-workmarks) — implement Stamp/Workmark commands and transaction/provenance rules.

[FLO-115](https://linear.app/flowtation/issue/FLO-115/build-exceptions-workflow-for-unpaid-disputed-and-failed-work) — implement exception/claim/resolution commands.

[FLO-130](https://linear.app/flowtation/issue/FLO-130/wire-participant-pwa-commands-to-canonical-state-and-whatsapp) — wire PWA/WhatsApp/Ops transports to the same command registry, prove cross-channel idempotency/convergence and delivery evidence.

[FLO-113](https://linear.app/flowtation/issue/FLO-113/build-tomorrow-command-centre-for-gaps-and-confirmations) — consume canonical projections/events for Tomorrow; do not create Tomorrow-only state transitions.

[FLO-116](https://linear.app/flowtation/issue/FLO-116/design-the-professional-work-card-system)/117/118 — consume safe Workmark/relationship projections; shareability may add a revocable read-token endpoint later but must not change Work Graph facts.

[FLO-119](https://linear.app/flowtation/issue/FLO-119/instrument-pilot-metrics-and-worker-day-economics) — derive operational/worker-day metrics from canonical timestamps/events and provider evidence.

---

# 17. What may still change during implementation

Implementation may refine:

- internal Python module names;
- exact database/RPC mechanism beneath a handler;
- queue implementation;
- Pydantic model composition;
- whether a safe read projection is served directly by Supabase or through FastAPI;
- provider-specific adapter details.

Implementation must **not casually redefine**:

- command meaning;
- actor/authorisation ownership;
- idempotency semantics;
- Assignment acceptance vs contractor confirmation vs travel authorisation;
- Stamp/Workmark provenance;
- cross-channel canonical-state rule;
- domain-before-message ordering.

Those are product/domain contracts.

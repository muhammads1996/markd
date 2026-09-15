# Technical Architecture v1 — MARKD App, WhatsApp and Workmark Pipeline

# MARKD Technical Architecture v1

## 1. Architecture objective

Build one canonical work-graph system that can be operated from a phone-first web app and fed by WhatsApp without creating separate sources of truth.

The architecture should optimise for:

- correctness and provenance
- fast product iteration
- low infrastructure cost
- operator usability
- safe AI-assisted parsing
- easy provider replacement
- participant contractor/worker surfaces without rewriting the data layer or adding a second frontend framework

---

## 2. High-level architecture

```text
Workers / Contractors / Operators
        │
        ├── WhatsApp text / voice / media
        │          │
        │          ▼
        │   WhatsApp Business Platform
        │          │ webhook
        │          ▼
        │   Webhook Edge Function
        │          │
        │          ├── Persist ChannelEvent
        │          └── Enqueue processing job
        │                     │
        │                     ▼
        │             Durable processing queue
        │                     │
        │                     ▼
        │          Message processing service
        │          ├ language/transcription
        │          ├ intent/entity extraction
        │          ├ deterministic validation
        │          └ ProposedAction
        │                     │
        │                     ▼
        └────────────── Ops Inbox / Review
                              │
                              ▼
                    Application command layer
                              │
                              ▼
                     Canonical PostgreSQL graph
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
          Ops PWA       future Work Card   future contractor UI
```

The application database is the source of structured truth.

WhatsApp is a channel, not a second application.

---

## 3. Recommended stack

### Frontend

Use a shared **Next.js + React + TypeScript PWA** product stack for the Ops Desk, public/shareable routes and the optional participant experience.

Reasons:

- one deployable frontend stack during the pilot
- phone-first browser deployment for operators, workers and contractors
- no App Store dependency
- installable PWA behaviour where platform support allows
- easy responsive UI and shared MARKD component system
- public/shareable Work Card routes
- server-rendered participant/contractor surfaces where useful
- less duplicated navigation, authentication plumbing and UI code than maintaining React Native in parallel

The participant PWA should use separate route groups/layouts and authorisation policies from Ops even though it lives in the same Next.js application. Worker/contractor identities still map to canonical Person / OrganisationContact records.

The participant PWA is not a participation dependency. Every essential worker/contractor journey must remain possible through WhatsApp and operator support.

Use PWA offline capabilities selectively. Do not build complex offline mutation/sync. A cached shell, safe static assets, last-known confirmed assignment or read-only Work Card may be introduced if connectivity testing justifies it, but consequential Assignment transitions must always revalidate against canonical server state.

React Native/Expo is explicitly deferred. Revisit native only if measured field requirements show that PWA limitations materially block essential capabilities.

### Backend platform

**Supabase**

Use:

- PostgreSQL
- Supabase Auth
- private Storage
- Edge Functions
- Supabase Queues / pgmq

Supabase Edge Functions are well suited to short-lived TypeScript webhook endpoints, while current Supabase guidance recommends moving heavier/long-running processing to background work. Supabase Queues provides a Postgres-native durable queue, which fits the event-processing pipeline without introducing separate message infrastructure during the pilot.

### WhatsApp

**Official WhatsApp Business Platform / Cloud API**

Use direct Meta integration or an approved provider only where it materially simplifies onboarding/coexistence/support.

Evaluate WhatsApp Business App + API Coexistence for the pilot number if current eligibility supports it. Treat Coexistence as an adapter capability, not an architectural dependency.

### AI / language services

Use provider interfaces rather than embedding one model vendor into domain code.

Interfaces:

- `TranscriptionProvider`
- `LanguageDetectionProvider`
- `StructuredIntentProvider`
- `TranslationProvider`

All model output must pass application schemas and policy before becoming a ProposedAction.

---

## 4. Repository structure

Recommended monorepo:

```text
/apps
  /web                 # Next.js PWA: Ops + participant + public/shareable routes
    /(ops)              # internal control-plane routes/layouts
    /(participant)      # worker + contractor mobile-first PWA routes/layouts
    /(public)           # revocable Work Card/share routes
/supabase
  /migrations
  /functions
    /whatsapp-webhook
    /process-channel-event
    /send-whatsapp
    /participant-command
/packages
  /domain              # pure domain types, commands, policies/state machines
  /db                   # generated DB types/repositories
  /contracts            # zod schemas/API contracts
  /messaging            # WhatsApp/provider adapters
  /language             # speech/LLM provider adapters
  /i18n                 # curated outbound + app copy keys
  /design-tokens        # MARKD Obsidian/Signal Lime tokens and spacing/type scales
  /observability
/tests
  /integration
  /e2e
```

Keep domain policy outside UI components and webhook handlers.

---

## 5. Database architecture

PostgreSQL remains the correct database for the pilot.

Do **not** introduce a graph database yet.

The work graph is naturally represented by relational entities and edges:

- Person
- WorkerProfile
- Organisation
- OrganisationContact
- Workmark
- VerificationClaim
- LabourRequest
- LabourRequirement
- Assignment
- CrewLink
- AvailabilitySignal
- ChannelEvent
- ProposedAction
- ExceptionCase
- PickupPoint
- AssignmentLogistics / travel-readiness fields

Graph-style views are produced with joins, views and derived aggregates.

Only revisit graph-specific storage when actual query/load evidence demands it.

---

## 6. Data modelling rules

### IDs

Use UUIDs for canonical entities.

Never use phone number, WhatsApp ID or external provider ID as the primary identity.

### Time

Store timestamps in UTC; render in local timezone.

Work-date semantics should support local calendar dates independently of message timestamps.

### Phone numbers

Normalise to E.164.

Allow multiple phone/contact methods per Person over time rather than assuming one immutable number.

### Soft lifecycle vs destructive delete

Operational records should generally use states/archival rather than hard deletion where audit history matters.

Privacy deletion/anonymisation requires a deliberate workflow.

---

## 7. Provenance architecture

Every consequential fact should be explainable.

Example chain:

```text
WhatsApp voice note
  ↓ ChannelEvent
Transcript
  ↓
ProposedAction
  ↓ operator confirms
Command
  ↓
Assignment outcome / Workmark
  ↓
VerificationClaim(s)
  ↓
Workmark presentation
```

A Workmark never loses the evidence chain that created it.

### VerificationClaim

Prefer multiple explicit claims over a single `verified=true` flag.

A fact may be supported by:

- worker statement
- contractor statement
- both parties
- MARKD-arranged assignment
- operator observation
- documentary credential verification

---

## 8. Command layer

All graph mutation should pass through explicit application commands.

Examples:

- `CreateWorker`
- `CreateOrganisation`
- `RecordAvailability`
- `CreateLabourRequest`
- `CreateAssignment`
- `ConfirmAssignment`
- `CloseAssignment`
- `RecordHistoricalWorkClaim`
- `AddVerificationClaim`
- `OpenExceptionCase`
- `ResolveExceptionCase`
- `RecordWorkerTravelPreferences`
- `SetAssignmentLogistics`
- `AuthoriseAssignmentTravel`
- `AcknowledgeAssignmentLogistics`
- `RecordAssignmentArrival`

Travel authorisation must be a deterministic application transition, never inferred directly from a worker saying YES to an offer.

This prevents Ops, the participant PWA, the WhatsApp processor and future API/native clients from each inventing different mutation rules.

### Straight-through normal path vs Ops review

The command layer must support a future **self-service normal path / human-by-exception** model without relaxing provenance or trust controls.

A valid participant command should not require an operator merely because early pilot screens were operator-led. Policy decides whether a command can execute based on actor identity/authorisation, completeness, current state, risk and ambiguity.

Examples:

- authenticated contractor creates a complete Labour Request → deterministic command may execute directly;
- authenticated/strongly resolved worker accepts or declines an offered Assignment → deterministic response transition may execute directly;
- contractor explicitly confirms selected workers and logistics → authorised contractor command may execute directly;
- deterministic `AuthoriseAssignmentTravel` evaluates required state/facts; no model may infer travel readiness;
- ambiguous free-form WhatsApp, unresolved identity, conflicting facts, trust/economic negatives, disputes or unsafe transitions → ProposedAction/Ops review.

Keep **operator confirmation** distinct from **authorised human confirmation**. The authorised human may be the participant whose action is being recorded. This removes unnecessary Ops touches without introducing opaque automated employment decisions.

---

## 9. WhatsApp webhook path

### Webhook receiver responsibilities

Keep the webhook endpoint thin and idempotent.

It should:

1. verify the provider webhook/signature/challenge as required
2. parse the minimum envelope
3. reject/ignore unsupported duplicate events safely
4. persist a ChannelEvent or raw-event record
5. enqueue processing
6. return quickly

Do not perform transcription or LLM calls synchronously in the webhook request.

### Idempotency

Enforce uniqueness on provider message/event IDs where applicable.

Processing jobs must be safe to retry.

---

## 10. Processing queue

Use a durable queue for:

- media retrieval
- transcription
- language detection
- structured intent extraction
- entity resolution
- ProposedAction creation
- outbound send jobs where useful

The queue consumer should implement:

- visibility timeout
- retry count
- dead-letter/failure handling strategy
- structured logging
- deterministic idempotency key

---

## 11. ProposedAction safety model

An AI model does not receive a service-role database client.

The model receives minimum necessary context and produces schema-constrained output.

Example:

```json
{
  "type": "RECORD_AVAILABILITY",
  "workerRef": "resolved-person-id",
  "date": "2026-09-14",
  "state": "available",
  "confidence": 0.93
}
```

The application validates:

- schema
- referenced entity existence
- allowed state transition
- actor/source permission
- risk tier
- need for confirmation

Only then can an application command execute.

---

## 12. Risk tiers

### Tier 0 — no graph mutation

Greeting, unsupported chatter, general query.

### Tier 1 — reversible/low-risk operational state

Example: self-reported availability.

May become auto-applyable after field confidence is demonstrated.

### Tier 2 — operational transaction

Example: Labour Request or assignment response.

Initially require confirmation where parsing ambiguity exists.

### Tier 3 — trust/economic outcome

Examples:

- no-show
- non-payment
- negative reuse preference
- completed Workmark
- dispute outcome

Require authorised deterministic confirmation/evidence policy.

---

## 13. Multilingual architecture

### Canonical facts are language-neutral

Do not store English-translated prose as business state.

Store structured values plus source ChannelEvent.

### Person communication preferences

Capture:

- preferred language
- additional languages
- preferred mode: text / voice / call

### Initial language set

- English
- Afrikaans
- isiXhosa

The language model must be extensible by table/config rather than a fixed three-value database enum.

### Curated outbound templates

Maintain versioned message templates per language for high-consequence communication.

Template keys may include:

- assignment_offer
- assignment_confirmed
- no_work_confirmed
- contractor_roster_confirmed
- cancellation
- payment_followup

Split worker-facing assignment communication into explicit semantic states:

- `assignment_offer_do_not_travel`
- `assignment_travel_ready`
- `assignment_changed`
- `assignment_cancelled`
- `pickup_reminder`

The rendered message must place the travel state before descriptive detail. A worker should not have to interpret whether an offer is final.

Insert dates/times/rates as typed variables rather than generated prose.

---

## 14. Voice architecture

### Worker accessibility policy

Voice support is not only an AI-ingestion convenience. It is an accessibility requirement for worker-facing journeys.

The channel adapter should support:

- inbound voice notes
- short deterministic outbound text in preferred language
- audio/voice follow-up where policy/provider constraints allow it
- operator-call fallback
- a communication-preference flag so operators know when not to rely on text alone

Do not assume that a translated paragraph is accessible merely because it is in the correct language.

Store incoming voice media privately or retain only as long as justified by policy.

Processing:

1. media reference received
2. background job retrieves content
3. transcription provider called
4. transcript stored separately with provider/model/confidence metadata
5. transcript feeds structured intent processing
6. operator can inspect transcript/source before consequential confirmation

Provider must be replaceable because South African language/accent performance should be field tested.

---

## 15. Frontend architecture

### Fulfilment / dispatch surface

The operator PWA should make the distinction between **offered**, **worker accepted**, **contractor confirmed** and **travel ready** visually obvious.

For each next-day assignment show:

- worker
- job/site area
- rate/terms status
- reporting mode
- pickup/reporting point and time
- contractor confirmation state
- travel-authorised state
- worker acknowledgement state
- cancellation/exception state

The Tomorrow screen should support grouped views by PickupPoint so an operator can coordinate a contractor collecting several confirmed workers from one place.

### Navigation

Primary:

- Inbox
- Tomorrow
- Search
- Work Book
- Exceptions

### Entity routes

Examples:

- `/workers/[id]`
- `/organisations/[id]`
- `/requests/[id]`
- `/workmarks/[id]`
- `/inbox/[id]`

### Creation

Prefer contextual quick-create sheets/dialogs where mobile usability benefits rather than adding numerous top-level “New X” pages.

### State

Use server/database state as truth. Keep client global state minimal.

---

## 15A. Worker WhatsApp interaction architecture

Use the simplest interaction primitive that completes the task reliably.

Recommended order:

1. **Reply buttons** for high-frequency binary/small-choice actions such as `YES`, `NO`, `CALL ME` when supported in the current message context.
2. **Short text / number fallback** (`1 YES`, `2 NO`, `3 CALL ME`) so the flow remains usable when interactive components are unavailable or confusing.
3. **Voice note** input accepted throughout.
4. **WhatsApp Flows** only for journeys that genuinely need several structured fields; do not make Flows the dependency for accepting a job.
5. **Human call** fallback for ambiguity or low digital confidence.

WhatsApp Cloud API supports interactive reply/list messages, location messages and Flows. Use those capabilities as progressive enhancement rather than forcing workers through complex forms.

### Location and pickup messages

A travel-ready confirmation should be able to send:

- plain-language area / landmark
- pickup or reporting time
- map location pin when useful
- contractor/site contact
- explicit self-travel vs pickup instruction

Do not require live worker tracking. Coarse worker base area and known PickupPoints are sufficient for the pilot unless field evidence proves otherwise.

### Data model guidance

Prefer structured, queryable fields rather than opaque notes:

`WorkerProfile`

- `base_area_id` or area text
- `travel_mode_preference`
- `pickup_needed_default`
- `travel_notes`

Related tables where needed:

- `worker_work_areas(worker_id, area_id, preference_state)`
- `worker_pickup_points(worker_id, pickup_point_id, preference_state)`
- `pickup_points(id, name, area, landmark, latitude?, longitude?, type, active)`

`LabourRequest / AssignmentLogistics`

- `reporting_mode`
- `pickup_point_id?`
- `report_at`
- `transport_provided`
- `transport_contribution_amount?`
- `confirmation_cutoff_at?`
- `travel_authorised_at?`
- `worker_acknowledged_at?`

Do not store exact home coordinates unless a later use case can justify that privacy cost.

---

## 16. Work Card architecture

Work Card is a projection of shareable Worker/Workmark data.

Implement a dedicated read model so private fields cannot accidentally leak through UI hiding alone.

Future shareable route:

```text
/work-card/<revocable-token>
```

The share token maps to a policy-controlled projection.

Do not expose raw worker table rows to a public route.

---

## 17. Authentication and authorisation

Pilot roles:

- `ops_admin`
- `ops_user`

Use RLS and server-side policy for sensitive data.

Operator authentication must never reuse future worker/contractor permissions.

Sensitive media and private notes require explicit access paths.

Service-role keys stay server-side only.

---

## 18. Storage

Separate logical buckets/paths for:

- worker portraits
- verification media
- WhatsApp media/transient processing
- future public/shareable derived assets

Default sensitive storage to private.

Use RLS/signed access and retention policies.

Do not make identity documents publicly addressable.

---

## 19. Privacy and retention

Before field launch define retention classes:

### Core business history

Workmarks, verification metadata, assignments and operational history retained according to lawful business purpose.

### Raw communications

Retain only as long as necessary for provenance, dispute and operating needs.

### Sensitive verification media

Minimise collection and retention; record verification outcome where raw document retention is not necessary.

### Voice/media

Define explicit expiry/deletion policy after transcription/resolution where feasible.

---

## 20. Observability

Minimum production observability:

- webhook request logs
- queue depth/age
- processing failures/retries
- provider latency/errors
- ProposedAction confirmation/rejection rate
- travel-ready confirmations sent
- worker logistics acknowledgement rate
- late cancellation after travel authorisation
- failed/unclear pickup exceptions
- unknown-sender events
- outbound send failures
- database errors
- frontend error monitoring

Prefer structured logs with correlation IDs from ChannelEvent through command execution.

---

## 21. Testing strategy

### Unit

Domain commands, state transitions, provenance rules, parser schemas.

### Database

Migration tests, RLS tests, derived relationship views.

### Integration

Webhook fixtures → ChannelEvent → queue → ProposedAction.

Provider adapters mocked by contract.

### E2E

Playwright phone-sized flows:

- create worker
- create contractor
- historical Workmark
- Labour Request
- assignment
- Tomorrow gap
- offer explicitly says do not travel
- worker accepts offer without travel authorisation
- contractor confirmation + logistics creates travel-ready state
- worker receives/acknowledges pickup instructions
- grouped PickupPoint dispatch
- close work
- Workmark appears
- unpaid exception
- Inbox ProposedAction review

### Field test

Real devices, mobile data, sunlight, one-handed use, slow connectivity.

---

## 22. Deployment

Pilot can remain operationally simple:

- hosted Next.js deployment
- managed Supabase project
- Supabase Edge Functions
- WhatsApp Business Platform
- CI migrations/tests on pull requests
- separate local/dev and production configuration

A separate microservice/container platform is unnecessary until workload or provider constraints justify it.

---

## 23. Technical decisions explicitly deferred

Do not add yet:

- graph database
- Kubernetes
- event-stream platform such as Kafka
- native mobile apps
- complex offline-first replication
- vector database/RAG over worker records
- automatic matching model
- biometric identification
- platform payment wallet
- microservices split

These solve scale we do not have.

---

## 24. Architecture invariants

These should survive implementation changes:

1.  One canonical work graph.
2.  WhatsApp is a channel, not a second source of truth.
3.  Workmark is backed by a canonical Workmark.
4.  Trust evidence preserves provenance.
5.  AI proposes structured actions; application policy mutates state.
6.  High-consequence claims are never accepted silently from uncertain model output.
7.  Private and shareable worker data are separate projections.
8.  No automatic worker ranking or universal score.
9.  Language supports communication, not suitability ranking.
10. Infrastructure remains boring until actual scale proves otherwise.
11. Worker acceptance is not travel authorisation.
12. Core worker flows remain usable through WhatsApp/voice/call without a MARKD app.
13. Location precision is minimised; familiar areas and pickup points are preferred over unnecessary live tracking.

---

## 25. Implementation order

1.  schema + migrations + audit primitives
2.  operator auth/RLS/storage
3.  worker/organisation onboarding
4.  work history/search
5.  WhatsApp webhook + ChannelEvent
6.  queue + ProposedAction processing
7.  Ops Inbox
8.  Labour Request + Assignment
9.  Tomorrow
10. closeout → Workmark/Stamp
11. Exceptions
12. accessible worker offer + travel-ready WhatsApp flow
13. pickup/reporting logistics + Tomorrow dispatch surface
14. multilingual voice pipeline
15. Work Card trust surfaces
16. metrics/operational instrumentation

This order keeps the graph usable even if the WhatsApp intelligence takes longer than expected.

---

## Worker-facing simplicity invariant

Backend precision must not become frontend ceremony.

The canonical Assignment may preserve granular timestamps and states, but the normal worker-facing flow is intentionally compressed to:

`OFFER → worker replies once → CONFIRMED / GO`

Rules:

- no mandatory post-confirmation acknowledgement
- no WhatsApp Flow or form in the core journey
- no route planner, fleet subsystem, live worker tracking or home-coordinate capture for the pilot
- pickup/reporting location may be plain text; a reusable PickupPoint is an optimisation, not a required entity for every assignment
- voice note and call remain valid fallbacks
- richer internal states exist only to make the simple external promise safe

Architecture should prefer the smallest data model and workflow that can reliably prevent speculative travel.

---

## 15B. Participant mobile application architecture

The approved participant-facing UX is specified in **Product Design System & Mobile UX v1 — MARKD**.

### Architectural rule: state, not screens, is shared

The mobile app must not create app-local business state for offers, assignments, travel readiness, completion or Workmarks.

All consequential actions execute the same application command layer used by Ops and WhatsApp.

Examples:

- `RespondToAssignmentOffer`
- `AuthoriseAssignmentTravel`
- `AcknowledgeAssignmentLogistics`
- `CreateLabourRequest`
- `SelectWorkerForRequirement`
- `CloseAssignment`
- `CreateOrUpdateWorkmark`
- `SetAvailability`

The command layer returns canonical state; each surface renders a projection of that state.

### Identity and authentication

Operator authentication remains separate from participant authentication.

The mobile app should introduce participant principals that map to canonical `Person` and, when applicable, `OrganisationContact` records.

Initial mobile authentication should prefer verified phone-based identity (for example OTP) because phone/WhatsApp is already the operational identity anchor. Authentication must never make the phone number the primary database ID.

A worker without an app account remains a fully valid WorkerProfile.

### Read models / projections

Create policy-controlled read models rather than exposing raw tables directly to mobile clients.

Suggested projections:

- `worker_home_projection`
- `worker_work_projection`
- `worker_work_card_projection`
- `worker_profile_preferences_projection`
- `contractor_home_projection`
- `contractor_labour_book_projection`
- `contractor_request_projection`
- `contractor_worker_candidate_projection`

These projections must respect privacy, verification provenance and role-specific visibility.

### Cross-channel event propagation

Consequential command execution should emit a durable domain/outbox event.

Consumers may then:

- refresh relevant app projections
- update Ops views
- enqueue WhatsApp confirmation/mirroring
- enqueue push notification where configured
- record analytics/observability events

The UI must never directly send a WhatsApp message as the source of truth for a state transition.

### WhatsApp mirroring

Critical external state changes are mirrored through message policy rather than duplicate application logic.

Example:

`mobile TAKE JOB → RespondToAssignmentOffer → Assignment accepted → event → WhatsApp “Accepted. DO NOT TRAVEL YET.”`

`WhatsApp YES → ProposedAction/validated command → Assignment accepted → app refresh shows accepted/waiting`

For `WORK CONFIRMED`, the domain transition must occur before either push or WhatsApp confirmation is sent.

### Deep links

When useful, WhatsApp messages may include deep links into the mobile app for users who have it installed. Deep links are convenience only; the message itself must still contain enough critical information to complete the worker journey without opening the app.

### Design token sharing

Maintain brand/design tokens in a framework-neutral package where practical:

- colours
- spacing scale
- radius scale
- typography roles
- status semantics
- icon meaning

Do not attempt to share every React component between web and React Native. Share tokens, contracts and semantics first.

### Notification precedence

For critical worker states during the pilot:

1. canonical database transition
2. WhatsApp delivery attempt according to template/window policy
3. push notification for app users where enabled
4. Ops visibility and exception if critical delivery fails

App push must not be the only delivery path for travel-ready confirmation.

### Accessibility services

The mobile app must expose work-offer and confirmed-job text to device accessibility APIs and provide explicit `LISTEN` actions using approved localized copy. Generated speech may read deterministic approved text; it must not invent or paraphrase rate/date/location terms.

### Testing additions

Add cross-channel contract tests proving:

- accepting via app appears in WhatsApp/Ops state
- accepting via WhatsApp appears in app state
- duplicate responses are idempotent
- `accepted` cannot render as travel-ready
- travel-ready confirmation is impossible without the deterministic authorisation transition
- critical message/template variables equal app-visible rate/date/time/location values
- participant read models cannot expose private operator fields

### Implementation sequence

1. shared design tokens and mobile shell
2. authenticated participant principal + policy-controlled read models
3. worker Home/Work state flow
4. WhatsApp cross-channel mirroring
5. Work Card projection/sharing
6. contractor Home/Hire/Workers/Jobs

The mobile app must be developed as another adapter to the MARKD domain, not as a parallel product backend.

---

## Implementation audit note — 15 Sep 2026

The architecture remains valid, but current `main` should be read with the following implementation boundary:

**Implemented foundation:** monorepo/CI, canonical relational Work Graph, operator auth/RLS/private storage, operator onboarding/search/history, WhatsApp transport persistence/durable jobs, ProposedAction policy/contracts, language/transcription evidence abstractions and Ops Inbox.

**Not yet proven as live pilot-ready:**

- deterministic green operator E2E on CI — [FLO-127](https://linear.app/flowtation/issue/FLO-127/stabilise-main-verification-and-eliminate-operator-work-graph-e2e)
- independent security review of the current merged auth/RLS/storage surface — [FLO-128](https://linear.app/flowtation/issue/FLO-128/complete-independent-security-review-of-operator-auth-rls-and-private)
- live Meta Cloud API + media + outbound provider execution, concrete OpenRouter StructuredIntentProvider and concrete transcription provider — [FLO-129](https://linear.app/flowtation/issue/FLO-129/complete-live-whatsapp-transcription-and-openrouter-provider)
- participant-PWA ↔ WhatsApp command/state mirroring and cross-channel idempotency — [FLO-130](https://linear.app/flowtation/issue/FLO-130/wire-participant-pwa-commands-to-canonical-state-and-whatsapp)
- P3 LabourRequest/Assignment/travel-ready/completion flows — [FLO-112](https://linear.app/flowtation/issue/FLO-112/build-labour-request-and-assignment-workflow) through [FLO-115](https://linear.app/flowtation/issue/FLO-115/build-exceptions-workflow-for-unpaid-disputed-and-failed-work), [FLO-124](https://linear.app/flowtation/issue/FLO-124/build-accessible-worker-offer-and-confirmation-messaging) and [FLO-125](https://linear.app/flowtation/issue/FLO-125/build-travel-ready-assignment-and-pickup-coordination-flow)

A provider interface or schema is not evidence that a live provider path has been exercised. Likewise, a later participant-PWA amendment on a completed P2 issue does not retroactively mean that participant flow is already implemented.

Keep the architecture invariant: **one canonical domain state, multiple interfaces/transports**. Deferred work should extend the application command layer rather than create channel-specific business lifecycles.

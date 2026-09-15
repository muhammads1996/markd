# PRD v1 — MARKD Work Graph Operating Platform

# MARKD PRD v1 — Work Graph Operating Platform

## 1. Product statement

MARKD is a **phone-first operations platform and WhatsApp-connected work graph** for relationship-driven construction labour.

The first operational users of the software are MARKD operators. Workers and contractors may participate entirely through WhatsApp, calls and face-to-face interactions, while an optional **mobile-first Next.js participant PWA** provides a richer premium interface over the same Work Graph. Installing the PWA is never a prerequisite for receiving work, accepting work, confirming travel readiness, closing work or building a Work Card; it must also remain fully usable in a normal browser.

The product must capture the structured truth behind those interactions and progressively make the next labour request easier to fulfil.

The system is not primarily a job board.

---

## 2. Product objective

Create one canonical system that can answer:

- Who is this person?
- What work have they actually done?
- Who have they worked for?
- Which skills have been demonstrated in real work?
- Which contractors use them again?
- Who do they commonly work with?
- Who is available?
- What labour does a contractor need?
- Which known relationships can fulfil that need?
- What happened after the work?
- How trustworthy is each fact and where did it come from?

---

## 3. Product principles

1.  **One graph, many interfaces.** The participant PWA, Ops, WhatsApp and future clients use the same underlying data.
2.  **Provenance before automation.** Every consequential fact can be traced to its source.
3.  **Human judgment before algorithmic matching.** Software helps operators remember and filter; it does not make opaque labour decisions.
4.  **Relationship-first fulfilment.** Existing worker-contractor history is the first search space.
5.  **Conversation can be messy; data must be structured.** Voice notes, mixed language and shorthand are valid inputs.
6.  **No universal worker score.** Expose contextual facts and repeat economic relationships.
7.  **Workers do not need to install an app or PWA.** The platform must be useful through WhatsApp/calls and the participant web experience must work in-browser without installation.
8.  **Phone-first operations.** Core operator workflows must work one-handed and quickly in the field.
9.  **Minimal sensitive data.** Collect only what is operationally or legally justified.
10. **Software should remove clerical work before it removes operator judgment.**
11. **No worker should travel on ambiguity.** A work opportunity, worker acceptance and a travel-ready confirmed assignment are different states. MARKD must explicitly tell a worker when they should **not travel yet** and when work/pickup is sufficiently confirmed to travel.
12. **Accessibility is core product behaviour.** Worker journeys must work for people with low literacy, limited digital confidence, mixed-language communication and constrained data/transport budgets. Voice, calls, simple choices and human fallback are first-class interfaces.

---

## 4. Users and roles

### Operator

Internal MARKD user.

Can:

- create and edit records
- review WhatsApp-derived drafts
- capture relationships
- create labour requests
- manage assignments
- record work outcomes
- manage exceptions
- view private verification information

### Worker

A person participating as labour supply.

Does not require an application login to participate.

May interact through:

- optional MARKD mobile-first PWA (browser or installed)
- WhatsApp text
- WhatsApp voice notes
- phone calls
- physical onboarding
- portable/shareable Work Card

The worker must be able to move between the participant PWA and WhatsApp without creating duplicate or contradictory Assignment state.

### Contractor contact

A person representing themselves or an organisation that requests labour or confirms work history.

May initially interact through WhatsApp/calls only.

### Future contractor user

Authenticated self-service user. Explicitly not required for pilot launch.

### Operating-state direction

The operator is the primary **pilot** user, but MARKD must not encode “operator approval” as a permanent prerequisite for every routine transaction.

The target progression is:

**operator-led bootstrap → participant self-service for clear authorised actions → Ops review for ambiguity/exceptions/high-risk trust writes.**

A contractor should eventually be able to create demand, select/reuse workers and confirm its own crew directly. A worker should be able to accept/decline and receive confirmed travel instructions through WhatsApp or the participant PWA. Both paths use the same application commands and canonical state.

This is not automatic worker selection. Human economic choice remains explicit; MARKD removes unnecessary clerical relaying by its own operators.

---

## 5. Canonical domain model

The application should avoid modelling “workers” and “builders” as isolated human types.

### Person

Canonical human identity.

Fields include:

- id
- legal/display name where known
- preferred name
- phone numbers
- preferred language
- secondary languages
- preferred communication mode
- profile photo
- status
- created/updated metadata

A Person may have multiple roles over time.

### WorkerProfile

Worker-specific attributes attached to a Person.

Includes:

- home/base area
- labour stands used
- current operating status
- private ops notes
- identity-verification state
- work-eligibility/document state where justified
- worker-specific preferences
- usual pickup / meeting points
- worker-stated work areas or travel zones
- self-travel vs pickup-needed preference
- practical travel constraints such as earliest departure, number of taxi legs or areas that are not viable

Do not require workers to understand kilometre radii or provide a precise home address. Prefer familiar areas, stands, taxi ranks, landmarks and routes.

### Organisation

Represents a contractor, company or other employing/hiring entity.

Includes:

- legal/trading name where known
- organisation type
- operating areas
- typical work categories
- usual payment method
- usual pickup/site patterns
- status
- private ops notes

Sole traders can still be represented as organisations connected to a Person.

### OrganisationContact

Links Person ↔ Organisation with a role such as:

- owner
- foreman
- site supervisor
- office/admin
- buyer

### Site

A work location or reusable site context.

Do not require exact coordinates. Textual area/site description is sufficient initially.

### PickupPoint

A reusable, worker-understandable meeting or pickup location.

Examples:

- labour stand
- taxi rank
- building-supply store
- known landmark
- contractor yard
- site gate

Fields may include:

- human-readable name
- area
- landmark/instructions
- optional map coordinates/location pin
- point type
- active/inactive state

A PickupPoint is not a worker home address and must not be used to build unnecessary precise location history.

### AssignmentLogistics

The travel/reporting instructions attached to a LabourRequest or Assignment.

May include:

- reporting mode: `site` / `pickup_point` / `contractor_transport` / `other`
- pickup/reporting point
- pickup or report time
- site area / destination
- contractor transport provided: yes/no/unknown
- transport contribution where explicitly offered
- contact person
- landmark / plain-language instructions
- confirmation cutoff
- travel-authorised timestamp
- worker acknowledgement timestamp

The logistics model exists to create certainty before a worker spends money or time travelling.

### Skill

Controlled taxonomy of work capabilities.

Examples:

- general labour
- painting
- tiling
- brickwork
- plastering
- carpentry assistance
- steel/rebar
- paving

Skills may be:

- self-declared
- operator observed
- contractor confirmed
- demonstrated through Workmarks

Do not collapse these evidence types.

### LabourRequest

A contractor demand event.

Includes:

- requesting organisation/contact
- date
- site/area
- start/pickup time
- rate/terms where known
- status
- source channel
- notes

### LabourRequirement

Structured demand inside a LabourRequest.

Examples:

- 3 × general labour
- 1 × painter

Fields:

- skill/work type
- headcount
- filled count derived from assignments
- optional requirement notes

### Assignment

Links a WorkerProfile to a LabourRequest.

Lifecycle may include:

- proposed
- contacted / offered
- worker interested / accepted
- contractor confirmed
- travel ready / authorised
- worker acknowledged logistics
- arrived / started where captured
- cancelled
- no-show
- completed

`worker accepted` must never be presented as permission to travel unless the assignment is also travel-ready. A late contractor cancellation after travel authorisation is a distinct operational exception, not an ordinary cancellation.

### Workmark

The canonical record that real work occurred or was expected to occur between a worker and organisation.

A Workmark may originate from:

- a MARKD Assignment
- a verified historical relationship
- direct operator observation
- later imported evidence

Fields include:

- worker
- organisation
- contact where relevant
- date/date range
- site
- skill/work categories
- attendance state
- completion state
- payment state
- amount/method where known
- worker reuse preference
- contractor reuse preference
- provenance state
- source references

### Stamp

The **action** that captures, confirms or updates a Workmark.

A Stamp is not a separate domain record or duplicate truth store. The resulting Workmark remains the durable provenance-aware record and is surfaced through work history and the Work Card.

### Relationship

A derived or explicit edge between WorkerProfile and Organisation.

Contains contextual facts such as:

- first/last confirmed work date
- confirmed Workmark count
- repeat usage
- most common skills used
- latest bilateral reuse preference

Avoid a global numeric rating.

### CrewLink

Person-to-person relationship used to represent people who commonly work together.

Initial implementation can be lightweight and evidence-based.

### AvailabilitySignal

Records availability for a time window.

Fields:

- worker
- available date/window
- availability state
- source
- captured at
- expires at where appropriate

Availability is ephemeral evidence, not a permanent worker attribute.

### ChannelEvent

Immutable-ish record of an external interaction relevant to the graph.

Examples:

- WhatsApp text
- WhatsApp voice note
- WhatsApp image/document
- phone-call outcome entered by operator
- operator command

Fields:

- provider/channel
- external message id
- sender/recipient
- timestamp
- content/media reference
- original language
- transcript if generated
- processing state

### ProposedAction

Structured interpretation of a ChannelEvent.

Examples:

- mark worker available
- create LabourRequest
- confirm assignment
- propose Workmark outcome
- open payment exception
- link historical relationship

Fields include:

- action type
- extracted entities
- confidence
- validation errors
- risk tier
- review state
- operator confirmation

High-trust mutations require explicit confirmation.

### VerificationClaim

Represents evidence supporting a fact.

Examples:

- worker claims prior employment
- contractor confirms prior work
- operator inspected document
- assignment arranged by MARKD
- both parties confirmed completed work

Verification must be additive and traceable rather than represented by one magic `verified=true` flag.

### ExceptionCase

Operational issue requiring follow-up.

Initial types:

- unpaid
- disputed
- no-show
- contractor cancellation
- identity/document concern
- ambiguous WhatsApp action

---

## 6. Terminology

Preferred product language:

| Internal/domain concept  | Product language        |
| ------------------------ | ----------------------- |
| WorkerProfile            | Worker                  |
| Organisation             | Contractor / Company    |
| Workmark                 | Workmark                |
| Collection of Workmarks  | Work history            |
| Portable profile         | Work Card               |
| LabourRequest            | Labour Request          |
| LabourRequirement        | Labour Need / Positions |
| Assignment               | Assignment              |
| Worker↔Organisation edge | Work Relationship       |
| ExceptionCase            | Exception / Follow-up   |

Avoid “builder” as the canonical domain term because the network may include subcontractors, facilities firms, supervisors and larger employers.

---

## 7. Operator application information architecture

### A. Inbox

Purpose: turn messy incoming communications into structured graph actions.

Shows:

- unprocessed WhatsApp events
- ProposedActions awaiting review
- ambiguous entity matches
- contractor requests needing confirmation
- worker availability messages
- completion/payment messages
- voice-note transcripts

Primary interaction:

**See original → see structured interpretation → confirm/edit/reject.**

### B. Tomorrow

Purpose: operational command centre for the next work day.

Shows:

- open Labour Requests
- total positions required
- confirmed assignments
- unfilled positions
- workers marked available
- workers contacted but awaiting reply
- contractor confirmations outstanding
- likely no-show/replacement risks when manually flagged

The screen should optimise for closing gaps, not analytics.

### C. Search

Global search across:

- people
- phone numbers
- workers
- contractors/organisations
- sites
- skills
- Work Stamps

Phone-number search must be excellent because WhatsApp identity frequently begins with a number.

### D. Work Book

Graph/history surface.

Supports:

- chronological Workmarks
- relationship exploration
- worker ↔ contractor history
- crew connections
- skill evidence
- historical vs MARKD-arranged provenance

### E. Exceptions

Queues:

- unpaid
- disputed
- no-show follow-up
- ambiguous records
- verification problems

Exceptions should never disappear into private notes.

---

## 8. Worker detail and Work Card

### Internal Worker view

Operator sees:

- portrait
- name / preferred name
- contact details
- language and communication preference
- current availability
- skills and evidence types
- Work Record
- contractor relationships
- crew links
- identity/document verification state
- private ops notes
- exceptions

### Portable Work Card

The Work Card should borrow the **rapid visual comprehension** of sports player cards without gamifying human worth.

Professional visual hierarchy:

- portrait
- preferred/display name
- primary demonstrated work categories
- base area where appropriate
- identity/credential verification markers where safe
- confirmed Workmark count
- repeat contractor count
- recent activity
- demonstrated skills with evidence counts
- optional attendance evidence only with sufficient sample size

Never show:

- overall rating
- “OVR 87” type score
- private notes
- ID number/document
- unreviewed disputes
- private home address

A future shareable Work Card may use a revocable link or QR code.

---

## 9. Contractor / organisation view

Internal Contractor view should display:

- organisation details
- contacts
- operating areas
- common work types
- sites
- recent Labour Requests
- workers previously used
- preferred/repeat workers
- open assignments
- payment/dispute exceptions
- private ops notes

The most important section should be **their known labour network**, not a public rating.

Future contractor-facing product can evolve into a workforce book built on the same page.

---

## 10. WhatsApp bridge

### Principle

WhatsApp is a first-class interface into the same graph, not a notification integration.

For workers, WhatsApp is also the primary pilot interface for **certainty before travel**. The core journey must not require browsing a job board or repeatedly checking an app.

### Inbound flow

`WhatsApp → webhook → ChannelEvent → queue → language/transcription → intent/entity interpretation → ProposedAction → policy/risk check → operator or user confirmation → graph mutation`

### Raw-source preservation

For every action derived from WhatsApp, retain enough provenance to answer:

> Why does MARKD believe this fact?

Store source message identifiers and original text/media references subject to retention/privacy policy.

### Risk tiers

**Tier 0 — informational/no write**

Example: greeting.

**Tier 1 — low-risk write**

Example: worker says they are available tomorrow.

May eventually auto-apply with reversible event history.

**Tier 2 — operational write**

Example: contractor requests three labourers tomorrow.

Require structured confirmation until confidence is proven.

**Tier 3 — trust/economic write**

Examples:

- worker did not show
- contractor did not pay
- contractor would not use worker again
- completed Work Stamp

Require authorised confirmation and provenance.

### Operator commands

Whitelisted MARKD operators may eventually send structured or free-form commands through WhatsApp.

Example:

> “Mark Sipho available tomorrow.”

The result should still be shown as a confirmable ProposedAction for consequential changes.

---

## 11. Voice-note flow

Voice notes are first-class ChannelEvents.

Pipeline:

1. receive media event
2. securely retrieve media
3. transcribe
4. detect language/code switching where possible
5. retain original media reference according to retention policy
6. create ProposedAction from transcript
7. display transcript and structured interpretation together

Never silently create negative trust events from imperfect transcription.

Provider abstraction should allow testing different speech models for South African accents/languages.

---

## 12. Language model

Initial field languages:

- English
- Afrikaans
- isiXhosa

Data model must support additional languages without schema redesign.

For each Person capture:

- preferred language
- additional languages
- preferred communication mode: text / voice / call

### Language-neutral domain state

Structured graph facts are never stored as translated prose.

Example:

Inbound isiXhosa message expressing tomorrow availability becomes:

- worker_id
- date
- `available`

with original message/language retained in ChannelEvent provenance.

### Outbound language policy

Use curated/approved templates for high-consequence messages:

- work confirmation
- rate
- date/time
- site/pickup instructions
- cancellations
- payment follow-up
- safety instructions

### Low-literacy and low-friction worker messaging

For worker-facing operational messages:

- keep one decision per message where practical
- put the most important state first: **OFFER — DO NOT TRAVEL YET** vs **CONFIRMED — TRAVEL / GO TO PICKUP**
- use short familiar words in the worker's preferred language
- keep dates, times and Rand amounts visually prominent
- use reply buttons or simple numeric/text responses such as `1 YES`, `2 NO`, `3 CALL ME` where supported
- accept voice notes as equivalent input, not as an edge case
- provide a call/human fallback for workers who struggle with text
- use a location pin **plus** a familiar landmark/plain-language description; never require map literacy
- avoid relying on icons alone unless tested with the actual worker population
- repeat critical dynamic facts back before travel: day, time, pay/rate, pickup/reporting point and who to contact

For workers who prefer voice, MARKD should be able to provide a short audio explanation or operator call in addition to the structured written confirmation.

Generative translation may assist casual conversation but must not alter contractual/operational facts.

---

## 13. Worker onboarding flow

Target: a field operator can create a useful worker record in approximately two minutes, then enrich it later.

### Minimum viable capture

- photo
- preferred/display name
- WhatsApp phone
- preferred language
- base area
- primary skills
- status

### Progressive enrichment

- additional languages
- labour stands
- identity/document inspection
- credentials
- people commonly worked with
- previous contractors
- historical Workmark claims

Do not make enrichment block initial capture.

---

## 14. Contractor onboarding flow

Target: create a usable contractor record while on a call or sitting with them.

Minimum:

- person/contact name
- phone
- organisation/trading name where applicable
- operating areas
- typical work
- status

High-value onboarding question:

> **Who do you already call when you need people?**

Capture named workers and create relationship claims pending verification rather than forcing the contractor to build a formal workforce list.

---

## 15. Historical Workmark flow

Historical relationships are important for cold start but must not impersonate platform-era evidence.

Flow:

1. Worker or contractor claims prior work.
2. Create historical Workmark in `claimed` state.
3. Record claimant and approximate details.
4. Seek counterparty confirmation where practical.
5. Append VerificationClaims as evidence arrives.

Suggested provenance labels:

- worker claimed
- contractor claimed
- worker confirmed
- contractor confirmed
- both confirmed
- MARKD arranged
- operator observed

Do not flatten these into a single verified checkbox.

---

## 16. Labour request and fulfilment flow

### Worker mobility objective

A core worker-side outcome is to reduce speculative travel to labour stands, pickup points or sites when no work is actually secured. MARKD should use network coordination to convert an uncertain trip into a confirmed trip wherever possible.

### Capture

Request may originate from:

- operator app
- WhatsApp text
- WhatsApp voice note
- phone call captured by operator
- future contractor portal

### Selection order

Operator workflow should surface:

1. workers this contractor explicitly wants again
2. workers previously used by this contractor
3. workers connected through trusted crews/relationships
4. other suitable workers in the local network

Operator search may expose **job-relevant, factual information** such as demonstrated/self-declared skills, explicit current availability, prior work with the requesting contractor and worker-stated travel/pickup constraints.

Travel/pickup constraints are eligibility and coordination facts, not a hidden employability score. Where two workers are otherwise suitable, the operator should be able to avoid proposing work that is clearly impractical for a worker to reach.

### Certainty-before-travel protocol

The fulfilment workflow should distinguish four worker-facing moments:

1. **Availability** — "I can work tomorrow." No specific job exists yet.
2. **Offer / interest check** — MARKD shares the job area, expected rate/terms, approximate time and travel arrangement. The message explicitly says **do not travel yet**. Worker can accept/decline or request a call.
3. **Travel-ready confirmation** — after contractor/ops confirmation and logistics are complete, MARKD sends the worker a clear confirmation containing work date, reporting/pickup time, reporting/pickup point, site/area, rate/terms and contact. Only this state authorises travel.
4. **Change / cancellation** — any change after confirmation is pushed immediately. Cancellation after travel authorisation opens an ExceptionCase and is measured separately.

A worker's acceptance of an offer reserves/expresses interest; it does not itself guarantee work.

### Pickup and muster model

The pilot should support contractor pickup and grouped pickup without becoming a transport company.

Examples:

- "Meet at Bellville taxi rank, 05:45. Johan's bakkie collects confirmed workers at 06:00."
- "Report directly to the site gate at 07:00."
- "Meet at the labour stand only if MARKD sent the confirmed message."

Reusable PickupPoints allow MARKD to learn practical labour corridors and reduce instruction errors. MARKD records the plan; the contractor or agreed transport provider remains responsible for the actual transport unless a future commercial model deliberately changes that boundary.

### Optional future worker app / PWA

A future worker-facing app may mirror the same state machine with large tap targets, audio playback and offline-readable confirmed job details. It must be an optional convenience layer over the same graph, not a prerequisite for receiving work. WhatsApp/call participation remains supported.

Preferred language exists to improve communication and localisation; it must not become an employment-ranking signal or proxy for worker suitability.

No automatic ranking score or employment recommendation is produced.

### Confirmation

Track separately:

- worker acceptance
- contractor confirmation

Do not assume assignment merely because an operator contacted a worker.

### Replacement

No-show/cancellation should create an explicit gap and allow fast replacement while preserving the failed assignment history.

---

## 17. Close-the-loop flow

Every MARKD-arranged assignment must end in an explicit outcome.

Minimum closure questions:

- Did the worker attend?
- Was work completed / was the worker released early?
- Would contractor use the worker again?
- Would worker work with contractor again?
- Was payment made?
- Amount/method if known?

These responses create/update Workmark evidence.

Unanswered outcomes remain visible as follow-up work rather than silently becoming success.

---

## 18. Exceptions and disputes

### Unpaid

Capture:

- amount expected where known
- due/expected payment timing
- worker claim
- contractor response
- resolution

### Disputed

Do not encode one side's allegation as objective truth.

Store:

- claims
- counterclaims
- evidence
- operator notes
- resolution state

### No-show

Preserve context:

- assignment confirmation state
- cancellation timing
- communication attempts
- worker explanation where provided

Trust surfaces must distinguish allegation from confirmed outcome.

---

## 19. Search and graph behaviour

The database may remain relational PostgreSQL initially.

A specialist graph database is not justified for v1.

Use explicit relational tables and derived views/materialised aggregates where needed.

Graph relationships should be queryable through conventional joins:

- Worker → Workmarks → Organisation
- Organisation → Workmarks → Worker
- Worker → CrewLinks → Worker
- LabourRequest → Assignments → Worker

Only revisit graph-specific storage if actual query complexity or scale demands it.

---

## 20. Technical direction

Preferred initial stack:

- TypeScript
- Next.js/React PWA
- PostgreSQL via Supabase
- Supabase Auth for operators
- Supabase private Storage
- Supabase Edge Functions or small TypeScript service for webhooks
- durable queue for WhatsApp/event processing
- official WhatsApp Business Platform / Cloud API
- provider abstraction for transcription and language processing

### Architecture rule

External AI/LLM providers never receive unrestricted database authority.

They may return structured proposals validated by deterministic schemas and application policy.

---

## 21. Authentication and permissions

Pilot roles:

- `ops_admin`
- `ops_user`

Sensitive capabilities requiring explicit permission:

- identity/document access
- private notes
- dispute details
- deletion/anonymisation
- exported worker data

Future contractor/worker auth must be designed separately rather than reusing operator privileges.

---

## 22. Privacy/security requirements

- private storage bucket for sensitive documents
- signed/time-limited media access
- row-level access controls
- no direct public document URLs
- audit metadata on trust-relevant edits
- phone numbers normalised and unique-aware
- minimise retention of raw identity documents
- separate externally shareable fields from internal/private fields
- define correction/anonymisation workflow
- database backups and restore testing before real field usage

---

## 23. Event/audit model

Trust-relevant facts should not be destructively overwritten without history.

At minimum preserve:

- actor
- action
- timestamp
- source channel
- previous value where appropriate
- resulting value
- source ChannelEvent/VerificationClaim

This is especially important for:

- payment
- attendance
- reuse preference
- identity verification
- Workmark verification
- dispute resolution

---

## 24. Operational metrics built into product

The system must make it possible to calculate:

- Labour Requests received
- requested worker positions
- fulfilled positions
- completed worker-days
- time to first candidate
- time to confirmed fulfilment
- no-show rate
- repeat contractor usage
- repeat worker-contractor pairings
- share fulfilled from known relationships
- worker response rate
- payment confirmation rate
- disputes
- operator touches/minutes per fulfilment
- revenue per completed worker-day once charging begins

Metrics should be generated from operational events, not manually maintained dashboard counters.

---

## 25. Pilot product surface

Required initial product surfaces:

1. **Inbox**
2. **Tomorrow**
3. **Search**
4. **Worker detail**
5. **Contractor / Organisation detail**
6. **Labour Request detail**
7. **Work Record / Work Book**
8. **Exceptions**

Creation/edit flows may be contextual drawers/pages rather than separate navigation items.

This is intentionally different from a CRUD menu such as “New Worker / New Contractor / New Job”.

---

## 26. Non-goals for pilot

Do not build yet:

- worker native app
- contractor native app
- public marketplace browse
- automatic AI worker ranking
- universal worker score
- live GPS tracking
- platform payroll
- holding worker funds
- detailed project management
- timesheets for large employers
- invoicing suite
- automatic disciplinary/blacklist logic
- multi-city architecture beyond normal location extensibility
- complicated BI dashboards

---

## 27. Product stage gates

### Stage 0 — manual operating proof

App may exist, but operators remain in control.

### Stage 1 — graph usefulness

Known history measurably improves fulfilment.

### Stage 2 — WhatsApp leverage

Inbound communication reliably reduces manual data entry.

### Stage 3 — trust surface

Enough verified events exist that Work Cards become genuinely useful.

### Stage 4 — contractor self-service

Only introduce when contractors repeatedly ask to perform actions themselves.

### Stage 5 — workflow automation

Automate specific proven repetitive decisions, not theoretical ones.

---

## 28. Acceptance definition for pilot readiness

MARKD is field-pilot ready when two operators can, from their phones:

1.  create/find a worker quickly
2.  create/find a contractor quickly
3.  capture an existing work relationship
4.  receive/capture a Labour Request
5.  identify known and available workers
6.  assign and confirm workers
7.  see tomorrow's gaps
8.  close completed work into Work Stamps
9.  preserve verification provenance
10. manage unpaid/disputed/no-show exceptions
11. ingest at least basic WhatsApp events into the Inbox
12. operate without exposing private worker information to contractors

The test of success is not feature completeness. It is whether the product makes the real operating loop faster and more reliable.

---

## Worker mobility success measures — amendment

In addition to fulfilment and graph metrics, measure:

- offers sent vs workers expressing interest
- assignments reaching travel-ready confirmation
- time between travel-ready confirmation and report/pickup time
- worker acknowledgement rate
- self-travel vs pickup-point vs contractor-transport assignments
- late contractor cancellations after travel authorisation
- worker-reported unnecessary trips avoided
- worker-reported transport spend avoided where practical to capture
- show-up rate by reporting/transport mode
- failed pickups / unclear-location exceptions

Do not infer saved transport costs from GPS tracking. Prefer explicit worker feedback and operational event data.

### Research basis for this amendment

The amendment is grounded in South African evidence that transport cost and spatial mismatch materially affect work-seeking and employment, including Cape Town evidence on disproportionate low-income commuting burdens and Harambee evidence that proximity / fewer taxi legs improve employment access and retention. It also follows inclusive-mobile research recommending voice notes, simple choices, numbers, contextual visuals and human fallback for people with reading/writing or digital-literacy barriers. Current South African blue-collar products such as Blue Jobs, JobOp and JobZapp additionally validate WhatsApp availability checks and proximity-aware work matching, but MARKD differentiates by making travel certainty part of the assignment/work-history lifecycle rather than merely a lead-discovery step.

---

## Worker interaction simplicity constraint

The system may preserve detailed internal state for correctness and provenance, but **worker-facing interaction must remain extremely simple**.

For the normal fulfilment path, a worker should experience at most two meaningful messages/states:

1. **OFFER — DO NOT TRAVEL YET** — essential job facts plus one decision: YES / NO / CALL ME (or voice note).
2. **CONFIRMED — GO** — final time, pay/terms and pickup/reporting instructions.

A worker should not be required to acknowledge the second message, complete a form, navigate a menu or install the MARKD app before travelling. Operators may follow up only when delivery, ambiguity or operational risk requires it.

Internal states such as contractor confirmation, logistics readiness, cancellation provenance and travel authorisation must not leak into unnecessary user steps.

**Product test:** if the normal worker journey requires more than one reply before receiving confirmed travel instructions, it is probably too complicated for the pilot.

---

## 17A. Participant mobile app and cross-channel parity

The approved participant-facing design direction is defined in **Product Design System & Mobile UX v1 — MARKD**.

### Product position

The MARKD mobile app is an **optional engagement, fulfilment and trust surface**, not a replacement for WhatsApp and not a prerequisite for participation.

The implementation must preserve this hierarchy:

1. canonical Work Graph and command/state rules
2. Ops PWA as internal control plane
3. WhatsApp as the complete app-less participation channel
4. mobile app as the richer participant interface over the same state

### Worker mobile navigation

The initial worker app uses four primary destinations:

- **Home** — answers “Do I have work today?” and gives travel-ready instructions first
- **Work** — offers, accepted/waiting assignments, confirmed work and recent work
- **My Card** — portable proof of verified work history and Work Graph evidence
- **Profile** — language, audio/read-aloud, availability, travel preferences and channel preferences

### Contractor / Builder mobile navigation

The initial contractor-facing app mode uses:

- **Home** — next-day crew readiness, gaps and known-worker shortcuts
- **Hire** — fill a specific requirement, relationship-first
- **Workers** — reusable labour book / known worker network
- **Jobs** — active and upcoming Labour Requests and staffing state

“Builder” may be used conversationally in a tested UI, but the canonical domain remains Organisation / Contractor.

### Canonical worker-facing state language

Worker-facing app and WhatsApp state must use the same meaning:

1. **WORK OFFER — DO NOT TRAVEL YET**
2. **ACCEPTED — WAITING FOR CONFIRMATION — DO NOT TRAVEL YET**
3. **WORK CONFIRMED — TRAVEL READY**
4. **I'M ON MY WAY / LOGISTICS ACKNOWLEDGED** where useful
5. arrived/started only when operationally justified
6. completed → **Stamp** → Workmark closure

No visual shortcut, notification copy or app-local state may make `accepted` appear equivalent to `travel ready`.

### WhatsApp mirroring

Every essential external workflow must remain possible without the app.

At minimum, WhatsApp must support worker availability, work offer, accept/decline/call request, waiting acknowledgement, travel-ready confirmation, pickup/reporting details, cancellation/problem handling, completion/payment confirmation and Work Card sharing.

At minimum, WhatsApp must support contractor labour requests, requirement confirmation, selected-worker confirmation, crew status, replacement/cancellation handling and Stamp closure.

Actions performed in the app and actions performed through WhatsApp must resolve to the same command layer and canonical Assignment/Workmark state. App state must refresh from WhatsApp-originated actions; WhatsApp may mirror consequential app-originated state changes according to communication policy.

### Accessibility and visual direction

Participant-facing UI adopts the approved Obsidian + Signal Lime MARKD design system. Signal Lime is intentionally associated with confirmed, verified, actionable and successfully completed states.

Worker journeys require large targets, short copy, high contrast, icon + text, discrete pay/date/time/location fields, preferred-language rendering and `LISTEN`/audio support on work offers and confirmed jobs.

Accessibility must simplify interaction without reducing dignity. Do not design a childish “low literacy mode.”

### Work Card refinement

The Work Card is available inside the app and through a revocable share surface. It may display factual counts and contextual attendance evidence only when denominator/policy thresholds make the evidence meaningful. It must never display a universal human rating or leak private identity/contact data by default.

### Success criterion

Do not optimise primarily for app installs. A successful worker who receives, accepts, completes and compounds trusted work entirely through WhatsApp is a successful MARKD user.

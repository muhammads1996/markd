# MARKD — Repository Agent Orchestrator

This file is the primary operating contract for AI coding agents working in the MARKD repository.

Read this file before planning, modifying code, changing architecture, creating migrations, or implementing a Linear issue.

Repository code, migrations, and tests are implementation truth.

Linear is product, business, scope, and issue truth.

Do not invent requirements when either source can answer the question.

---

# 1. Mission

MARKD is building a trusted, bilateral work graph for relationship-driven construction labour.

The initial system is an operator-led platform that records real working relationships between workers and contractors and progressively makes future labour fulfilment easier.

MARKD is not initially:

- a generic job board
- an open labour marketplace
- construction project-management software
- payroll software
- a worker scoring platform
- an AI matching product
- a native mobile app
- a social network

The compounding asset is the verified local Work Graph created through real work.

---

# 2. Canonical terminology

These terms are architectural invariants.

## Stamp

A **Stamp** is an action or command confirming/capturing that work occurred or recording its outcome.

A Stamp is not a competing database entity representing the work itself.

Examples:

- operator Stamps completed work
- contractor confirms a Stamp
- WhatsApp message proposes a Stamp

## Workmark

A **Workmark** is the durable, provenance-aware record produced, confirmed, or updated through a Stamp.

Workmarks form the historical evidence layer of MARKD.

A Workmark may contain:

- worker
- organisation/contractor
- date/date range
- site
- skills/work category
- attendance outcome
- completion outcome
- payment state
- bilateral reuse preference
- provenance
- verification claims
- correction history

## Work Card

A **Work Card** is a derived profile/read model built from Workmarks and associated evidence.

It is not a separate source of truth.

## Work Graph

The **Work Graph** is the bilateral network formed from:

- people
- workers
- contractors/organisations
- Workmarks
- skills
- sites
- crews
- repeated working relationships

The Work Graph is MARKD's primary compounding data asset.

Do not introduce alternative canonical terms such as:

- Work Stamp as a persistent domain entity
- Work Event as a competing truth model
- Work Record as a separate data object
- universal worker rating
- global trust score

---

# 3. Sources of truth

Before implementing meaningful work, inspect the relevant sources.

Priority order:

1. Root `AGENTS.md`
2. The active Linear issue
3. MARKD Technical Architecture
4. MARKD PRD
5. MARKD Strategy / Business Architecture
6. Existing repository implementation and tests
7. Existing architectural decision records or package-level `AGENTS.md` files

When documents conflict:

- prefer the most recently updated explicit decision
- prefer canonical terminology in this file
- preserve existing architecture unless the active issue explicitly changes it
- surface material contradictions rather than silently choosing a new architecture

Do not use old conversation summaries, assumptions, or generic startup patterns as product truth.

---

# 4. Linear workflow

Implementation should normally begin from one Linear issue.

Do not implement the entire milestone from one prompt.

For every implementation task:

1. Read the active Linear issue completely.
2. Inspect related or blocking issues where relevant.
3. Read the minimum architecture/product documents necessary.
4. Inspect the current repository.
5. Identify the exact acceptance criteria.
6. Produce an implementation plan before significant changes.
7. Implement only the required scope.
8. Run all relevant verification.
9. Review the diff against the Linear issue.
10. Report completion and any deviation.

If no Linear issue is supplied, determine whether the request is:

- repository maintenance
- architecture work
- bug fix
- exploratory work

Do not silently turn an untracked request into broad product development.

---

# 5. Agent orchestration model

Use GPT-6 Sol where architectural judgment matters.

Use GPT-6 Luna for bounded, deterministic implementation work.

## Sol responsibilities

GPT-6 Sol should be used for:

- architecture
- schema design
- domain modelling
- security design
- RLS policy design
- cross-cutting refactors
- API contracts
- migration strategy
- issue decomposition
- implementation planning
- difficult debugging
- final code review
- release/readiness review
- PR review
- interpreting ambiguous requirements

Sol should not consume large amounts of context implementing repetitive boilerplate when GPT-6 Luna can safely do so from an approved plan.

## Implementation-agent responsibilities

GPT-6 Luna should implement bounded, well-specified tasks such as:

- isolated UI components
- straightforward CRUD
- test fixtures
- repetitive repository code
- typed adapters
- deterministic schema plumbing
- test cases from defined acceptance criteria
- documentation updates
- mechanical refactors

Implementation agents must not independently alter:

- domain boundaries
- database architecture
- security model
- public contracts
- canonical terminology
- auth model
- trust/provenance rules
- architectural invariants

If implementation reveals a required architectural change, stop and escalate to GPT-6 Sol.

---

## Delivery speed protocol

Move quickly by reducing repeated work, never by weakening security, domain, or
verification standards.

- Treat a Linear issue as **small by default**. Escalate it to a multi-phase
  plan only when it changes schema, RLS/auth, public contracts, provenance,
  or more than one package boundary.
- Timebox initial issue/repository discovery to the files and documents that
  can change the decision. Do not perform broad repository archaeology once
  the acceptance criteria and affected boundary are clear.
- A GPT-6 Sol agent owns the smallest viable plan for architectural or security work;
  delegate all bounded implementation immediately to GPT-6 Luna with that
  plan. Do not make GPT-6 Luna rediscover the whole architecture.
- Keep implementation and review agents on separate passes. The implementer
  should report an exact blocker promptly rather than repeatedly exploring or
  expanding scope.
- During implementation iterations, run the narrowest affected checks first
  (for example: a migration reset plus its integration test, or a single UI
  test). Run the complete applicable lint/typecheck/test/build gate once after
  the coherent diff is ready for review, then rerun only checks affected by
  review fixes before final confirmation.
- For small deterministic issues, use a brief plan, one implementation pass,
  focused verification, and a targeted Sol diff review. Do not require extra
  design documents, full E2E suites, remote deployments, or speculative
  follow-up work unless the active issue explicitly requires them.
- A review finding must be actionable and tied to an acceptance criterion,
  architectural invariant, security/privacy boundary, or concrete regression.
  Do not reopen an issue for optional polish.
- Update Linear at three points only: start, materially blocked, and complete.
  Keep comments concise and evidence-based.

---

# 6. Required development loop

For non-trivial work, use this sequence:

```text
Understand → Plan → Implement → Verify → Independent Review → Report
```

## Phase A — Understand

Read:

- this file
- active Linear issue
- relevant repo code
- relevant architecture docs

State:

- requested outcome
- relevant invariants
- files/packages likely affected
- assumptions
- risks

Do not modify code yet.

## Phase B — Plan

Produce a concrete implementation plan.

The plan should include:

- domain changes
- database/migration changes
- API/contracts
- UI changes
- security/RLS implications
- tests
- observability where relevant
- rollout/migration concerns

For small deterministic tasks, the plan may be brief.

For architecture-sensitive tasks, Sol must own the plan.

## Phase C — Implement

Implementation should follow the approved plan.

Prefer small coherent changes.

Do not perform opportunistic unrelated refactors.

Do not expand issue scope because another improvement seems useful.

## Phase D — Verify

Run the relevant quality gates.

At minimum where applicable:

```bash
lint
typecheck
test
build
```

Also run:

- migration validation
- database tests
- RLS tests
- integration tests
- Playwright tests

when the changed area requires them.

Do not suppress failing checks merely to obtain a green build.

Fix the cause or explicitly report the unresolved failure.

## Phase E — Review

After implementation, material work requires a separate GPT-6 Sol review of the actual diff.

Review against:

- Linear acceptance criteria
- architectural invariants
- correctness
- security
- privacy
- provenance
- maintainability
- test quality
- unnecessary complexity
- scope creep

The reviewer should inspect the actual diff, not only the implementation summary.

If review finds substantive issues, implementation returns to Phase C.

## Phase F — Report

Report:

- issue implemented
- important files changed
- architectural decisions made
- migrations created
- tests/checks run
- result of each check
- deviations from plan
- unresolved risks
- next issue enabled by this work

---

# 7. Architectural invariants

These rules should survive implementation changes unless explicitly superseded by an approved architectural decision.

## One canonical database

PostgreSQL/Supabase is the canonical structured source of truth.

Do not create competing stores for domain state.

## Relational first

The Work Graph should initially be modelled using PostgreSQL tables, relationships, views, and derived projections.

Do not introduce a graph database without demonstrated need.

## WhatsApp is a channel

WhatsApp is an interface into the same domain model.

It is not a separate product or truth store.

Expected flow:

```text
WhatsApp
→ webhook
→ ChannelEvent
→ queue
→ interpretation
→ ProposedAction
→ validation/policy
→ confirmation where required
→ domain command
→ canonical graph mutation
```

## AI proposes; application policy decides

LLM/model output must never receive unrestricted database mutation capability.

AI may create schema-constrained proposed actions.

Application code must validate:

- schema
- entity resolution
- permissions
- allowed state transition
- risk tier
- confirmation requirements

before any consequential mutation.

## Provenance is first-class

Trust-relevant facts must remain explainable.

The system should be able to answer:

> Why does MARKD believe this?

Preserve source evidence and verification claims.

Avoid a single `verified = true` abstraction where evidence has meaningful provenance.

## No universal worker score

Do not implement:

- overall worker rating
- star score
- 0–100 score
- opaque AI ranking
- global quality number

Expose factual, contextual evidence instead.

## Human judgment before automatic labour decisions

Initial fulfilment is operator-assisted.

Do not introduce automatic worker ranking or automated employment recommendations without explicit approval.

## Relationship-first fulfilment

When filling contractor demand, the conceptual order remains:

1. contractor's preferred workers
2. workers previously used by that contractor
3. trusted crew/relationship connections
4. relevant demonstrated workers elsewhere in the local graph
5. broader eligible pool

Do not build algorithmic matching prematurely.

## Workers do not need an app

Worker participation must remain possible through:

- WhatsApp
- voice notes
- calls
- operator onboarding
- face-to-face interaction

Do not make worker login or native-app installation an implicit dependency.

## Contractor login is not P1 scope

Do not add contractor self-service authentication until explicitly requested by a later issue.

## Phone-first operator UX

The initial operator application must be usable:

- on a phone
- one-handed
- under field conditions
- with minimal taps
- without desktop-only assumptions

## Sensitive data remains private

Never expose private verification or identity information via public Work Card projections.

Public/shareable representations require explicitly controlled read models.

---

# 8. Technology direction

Unless explicitly changed by architecture work, use:

## Frontend

- Next.js
- React
- TypeScript
- responsive PWA/web interface

## Backend/data

- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage
- Supabase Edge Functions
- Supabase Queues / pgmq where appropriate

## Validation/contracts

Use strongly typed schemas.

Prefer shared schema contracts between boundaries.

## Testing

Use the appropriate combination of:

- unit tests
- integration tests
- database tests
- RLS/security tests
- Playwright E2E tests

## Repository organisation

Expected high-level structure:

```text
/apps
  /web

/packages
  /domain
  /db
  /contracts
  /messaging
  /language
  /i18n
  /observability

/supabase
  /migrations
  /functions

/tests
  /integration
  /e2e
```

Do not split into microservices without evidence that the monorepo architecture is insufficient.

---

# 9. Domain design rules

Domain logic must not live primarily inside React components, route handlers, or webhook functions.

Prefer explicit domain/application commands.

Examples:

```text
CreateWorker
CreateOrganisation
RecordAvailability
CreateLabourRequest
CreateAssignment
ConfirmAssignment
CloseAssignment
StampWork
RecordHistoricalWorkClaim
AddVerificationClaim
OpenExceptionCase
ResolveExceptionCase
```

Commands should enforce business policy consistently regardless of caller.

The same domain command may eventually be called from:

- operator UI
- WhatsApp ProposedAction
- future contractor portal
- internal admin workflow

Do not implement different business rules per interface.

---

# 10. Database rules

Use UUIDs for canonical identifiers.

Do not use phone numbers or provider IDs as primary keys.

Store timestamps in UTC.

Model local work dates separately where calendar semantics matter.

Normalise phone numbers to E.164.

Use state/archive semantics where audit history matters.

Trust-relevant mutation history should not be silently destroyed.

Prefer migrations over ad-hoc manual database changes.

Every schema change must be reproducible from repository state.

Seed data must be clearly synthetic.

Never commit real worker PII into source control.

---

# 11. Supabase security rules

RLS is part of application architecture, not an afterthought.

Pilot roles:

- `ops_admin`
- `ops_user`

Do not create worker/contractor auth unless explicitly required.

Service-role credentials must never reach browser code.

Sensitive storage defaults to private.

Use signed/time-limited access where required.

Future public Work Cards should use dedicated policy-controlled projections rather than exposing raw internal tables.

Schema changes affecting RLS require security tests.

---

# 12. WhatsApp rules

Use the official WhatsApp Business Platform / Cloud API or an explicitly approved provider.

Do not use unofficial WhatsApp Web automation.

Webhook handlers should be:

- thin
- authenticated/verified
- idempotent
- fast

They should persist events and enqueue further processing.

Do not perform expensive transcription or model calls synchronously inside webhook requests.

Provider message/event IDs should be handled idempotently.

Raw source context should remain traceable through `ChannelEvent`.

---

# 13. AI and language processing rules

Model/provider dependencies should sit behind interfaces such as:

```text
TranscriptionProvider
LanguageDetectionProvider
StructuredIntentProvider
TranslationProvider
```

Do not embed one provider throughout domain code.

Machine-derived interpretations should record relevant provenance such as:

- provider
- model
- version
- confidence
- source event

Structured business state should remain language-neutral.

Original messages/audio remain evidence subject to retention policy.

Critical operational communication should use curated templates where appropriate.

Do not use generative translation to silently alter:

- rates
- dates
- times
- payment facts
- negative trust events

---

# 14. Trust and safety rules

Trust must remain bilateral.

Negative claims require explicit provenance.

Never convert a one-sided allegation directly into objective truth.

Examples include:

- no-show
- non-payment
- misconduct
- poor completion
- refusal to rehire

Store claims, confirmations, disputes, and resolutions separately where necessary.

Avoid silent blacklisting.

Workers must have correction/dispute paths where economically consequential data is retained.

---

# 15. Product scope discipline

Do not implement the following unless a current Linear issue explicitly requires them:

- native mobile applications
- graph database
- Kubernetes
- Kafka/event-stream infrastructure
- microservice decomposition
- vector database
- RAG over worker profiles
- automatic AI matching
- biometric identity
- platform-held worker wages
- payroll engine
- public worker marketplace
- worker-paid promotion
- global worker ranking
- broad construction management
- nationwide multi-region scale architecture

MARKD should remain operationally boring until actual usage demonstrates need.

---

# 16. UX principles

Operator workflows should optimise for speed and field usability.

Important surfaces include:

- Inbox
- Tomorrow
- Search
- Work Book / graph history
- Exceptions
- Worker detail
- Contractor detail
- Labour Request
- Assignment
- Workmark

Avoid dashboard-heavy design for its own sake.

The product should help operators act, not merely observe analytics.

A minimum useful worker or contractor should be capturable quickly and enriched progressively.

---

# 17. Work Card principles

Work Card should borrow scanability from sports/player cards without reducing human worth to a score.

Appropriate signals may include:

- portrait
- display name
- demonstrated work categories
- confirmed Workmarks
- repeat contractors
- recent activity
- evidence-backed skills
- appropriate verification markers

Never expose:

- universal score
- private notes
- identity numbers
- sensitive documents
- unresolved private disputes
- private address

Public/shareable Work Cards must use a separate projection/read model.

---

# 18. Testing expectations

Tests should verify behaviour, not simply implementation details.

Important domain scenarios include:

- create worker
- create contractor
- create historical Workmark claim
- verify/confirm claims
- create Labour Request
- create Assignment
- assignment confirmation
- no-show
- completed work
- Stamp closes work into Workmark
- repeat worker-contractor relationship
- unpaid exception
- disputed outcome
- WhatsApp ChannelEvent
- ProposedAction review
- Work Card privacy boundary

Any trust/provenance bug should be treated as high severity.

Any RLS/privacy leak should be treated as release-blocking.

---

# 19. Quality gates

Do not mark an implementation complete until all applicable checks pass.

The root repository should expose deterministic commands for at least:

```bash
lint
typecheck
test
build
```

Where applicable also run:

```bash
test:integration
test:e2e
test:db
test:rls
```

Do not disable rules or tests merely to pass CI.

Do not use `any`, unchecked casts, ignored promises, skipped tests, or lint suppressions as shortcuts without a documented reason.

---

# 20. Pull request discipline

Prefer one Linear issue per PR unless tightly coupled work justifies otherwise.

PR title should reference the Linear issue.

PR description should include:

- problem
- scope
- implementation summary
- architecture implications
- migrations
- screenshots where useful
- tests executed
- risks
- follow-up work

Large PRs should be decomposed where possible.

Do not bundle unrelated cleanup into feature PRs.

---

# 21. Review protocol

Material implementations must receive a separate review pass.

Use GPT-6 Sol for architecture/code review.

The reviewer should inspect:

- active Linear issue
- actual diff
- relevant architecture
- tests
- migrations
- security/RLS changes

Review priority:

1. correctness
2. security/privacy
3. domain integrity
4. provenance integrity
5. data migration safety
6. scope compliance
7. maintainability
8. test quality
9. performance
10. style

Do not approve because CI is green alone.

The reviewer should explicitly look for:

- accidental competing truth models
- hidden trust scoring
- data leakage
- missing provenance
- incorrect RLS
- overly broad service-role use
- non-idempotent webhook logic
- model output bypassing policy
- unnecessary architecture
- scope creep

---

# 22. Completion standard

"Done" means more than code exists.

An issue is complete only when:

- acceptance criteria are implemented
- relevant tests exist
- verification passes
- architecture invariants remain intact
- security/privacy consequences have been reviewed
- migrations are reproducible
- documentation is updated when required
- no known blocker is hidden
- Sol review passes for material changes

If something remains unresolved, report it explicitly.

---

# 23. Operational learning over speculative software

MARKD is being built alongside real field validation.

Do not encode assumptions as permanent architecture simply because they appear plausible.

Prefer:

```text
observe
→ model
→ implement
→ measure
→ refine
```

over:

```text
imagine complete future platform
→ build everything
```

Important business signals include:

- completed worker-days
- repeat contractor usage
- repeat worker-contractor pairings
- workers reaching a second confirmed Workmark
- workers receiving confirmed Workmarks from multiple contractors
- contractor-initiated Stamps without founder chasing
- contractors Stamping in consecutive months
- share of fulfilment from known relationships
- time-to-fill
- operator minutes per completed worker-day

The purpose of software is to make the work graph denser, more trustworthy, and more useful.

---

# 24. Escalation rules

Stop implementation and escalate to Sol when work requires changing:

- canonical terminology
- domain boundaries
- database architecture
- auth model
- RLS/security architecture
- trust/provenance semantics
- public API contracts
- Workmark semantics
- WhatsApp event architecture
- AI mutation policy
- labour-ranking logic
- deployment architecture

Do not make these decisions opportunistically during implementation.

---

# 25. Agent autonomy

Agents should be proactive within issue boundaries.

Do not ask the user questions that can be answered from:

- Linear
- repository code
- tests
- architecture documents
- existing conventions

Make reasonable implementation-level decisions autonomously.

Ask or escalate only when the answer materially changes product behaviour, architecture, legal exposure, trust semantics, or security.

---

# 26. Token and model reporting

At the end of every Codex planning, implementation, or review session, report:

```text
Model:
Role:
Input tokens:
Output tokens:
Total tokens:
Context utilisation:
```

If exact token telemetry is unavailable, explicitly state:

```text
Token telemetry unavailable from this execution environment.
```

Never invent token counts.

For orchestrated work also report which work was performed by:

- GPT-6 Sol
- GPT-6 Luna implementation agent(s)
- deterministic tools/tests

---

# 27. Default Codex behaviour

When a user gives Codex a Linear issue such as:

```text
Implement FLO-104
```

the expected behaviour is:

```text
1. Read AGENTS.md.
2. Fetch FLO-104 from Linear.
3. Read only the relevant supporting docs/issues.
4. Inspect the repository.
5. Determine whether Sol planning is required.
6. Produce or follow the implementation plan.
7. Delegate bounded implementation where appropriate.
8. Run all required checks.
9. Have Sol review material changes.
10. Fix review findings.
11. Report implementation, verification, deviations, risks and token usage.
```

Do not require the user to repeat the MARKD architecture in every prompt.

That is the purpose of this orchestrator.

---

# 28. Core principle

When uncertain, protect the compounding asset.

MARKD's value does not come from feature count.

It comes from trustworthy evidence of real working relationships.

Every architectural and product decision should therefore preserve this chain:

```text
real work
→ Stamp
→ provenance-aware Workmark
→ stronger relationship history
→ better Work Card
→ denser Work Graph
→ easier future work
```

Build for that loop.

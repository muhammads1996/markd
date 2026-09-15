# FLO-106/FLO-107 onboarding and read projections

MARKD onboarding writes to the same canonical `Person`, `WorkerProfile`,
`Organisation`, and relationship tables used by every later channel. The Ops
PWA does not own a parallel profile model.

## Fast onboarding and editing

Worker creation is draft-first because the required portrait upload cannot be
part of a PostgreSQL transaction. An active operator command creates or resumes
a draft and reserves its private portrait path. The client uploads to that path,
then a completion command verifies that the object exists before activating the
record. Failed uploads leave a resumable draft; cancellation archives the draft
and its related metadata.

Worker and organisation edits use explicit active-operator commands. These
commands validate E.164 phone numbers, reference data, lifecycle state, and all
multi-table changes in one database transaction. Browser code does not assemble
canonical records with independent table writes.

Active phone numbers are globally unique. Onboarding and editing report an
existing-person conflict rather than silently merging identities. This allows a
future verified participant account to link to the existing `Person` UUID
without creating another worker. Participant authentication and the account-link
table remain deferred to FLO-126.

Participant-editable preferences are structurally separate from private
operator data. Language and communication mode remain canonical on `people`;
availability remains in `availability_signals`; base area remains on
`worker_profiles`. Dedicated preference tables hold current primary-skill,
app/read-aloud, and familiar/travel-area choices. Append-only onboarding skill
evidence remains separate so editing a current preference never rewrites trust
provenance.

## Operator search

Global search is an active-operator database command. It can match normalized
phone input, names, workers, contractor contacts and organisations, sites,
areas, and skills, but returns an allowlisted result shape that never includes a
phone number. Draft, inactive, and archived records are excluded from the normal
search surface.

## Participant-safe projections

Participant-oriented read models are explicit, allowlisted,
`security_invoker` views over the canonical graph. They are shaped for future
worker Home, Work, My Card, contractor labour-book, and candidate-card screens.
They exclude phone numbers, private notes, birth dates, raw media paths,
verification documents, exception details, unresolved allegations, and source
references.

The views do not create participant access. Anonymous access remains revoked,
and current authenticated-but-unprovisioned users receive no rows through the
underlying RLS policies. FLO-126 must add participant principals and dedicated
self-access/write policies; it must not reuse operator privileges.

## Provenance presentation

Workmark origin and MARKD arrangement are separate facts:

- `historical_claim` describes historical provenance.
- `assignment_id is not null` means the work was MARKD-arranged.
- `channel_event` describes the capture channel and does not by itself mean the
  work was arranged by MARKD.

Participant trust summaries use confirmed, non-archived Workmarks. Skill
evidence captured during onboarding is declared/operator-captured evidence;
demonstrated-skill counts come from skills attached to confirmed Workmarks.

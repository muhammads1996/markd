# FLO-104 Work Graph schema

The Supabase/PostgreSQL schema is MARKD's sole canonical structured store. Its core edges are explicit relational foreign keys between people, worker profiles, organisations, sites, labour demand, assignments, Workmarks, skills, crews, and availability.

A **Stamp** remains an application command, not a persistent competing work entity. A **Workmark** is the durable record of work. `verification_claims` are additive, immutable assertions about exactly one Workmark, worker, organisation, or skill. A negative or disputed claim never changes a Workmark into objective truth by itself; confirmation/correction is separately represented in the claim stance and resulting Workmark lifecycle/outcomes.

The database records typed channel, proposed-action, and claim provenance on trust-relevant records. `audit_events` captures changes to Workmarks, assignments, claims, exceptions, and proposed actions through triggers; it is append-only and cannot be directly written, updated, or deleted. Audit payloads are allowlisted to material outcomes, lifecycle, archive state, and typed provenance: raw channel payloads, phone numbers, notes, and media are never duplicated. A trusted server command may set transaction-local `app.actor_person_id` for an operator, or explicitly set `app.actor_kind` to `system`; absent or invalid context is recorded as `unknown`.

Relationship views only include confirmed, non-archived Workmarks and use `security_invoker`, so callers must satisfy the underlying-table RLS policy. FLO-104 enables RLS on every public table with no policies: browser/API roles are denied by default. FLO-105 supplies the narrowly scoped pilot operator policies.

Phone values use E.164 (`+[1-9]` followed by up to fourteen digits), canonical identifiers are UUIDs, timestamps are UTC `timestamptz`, and calendar work is held in date columns. People record preferred language and the PRD communication abstraction: `text`, `voice`, or `call`. The committed seed is deterministic and deliberately synthetic.

Assignments and Workmarks are context-checked against their Labour Request, site, organisation, contact, and assignment relationships. Channel events and worker-skill evidence are append-only. The assignment lifecycle distinguishes a proposal, contact, worker acceptance, contractor confirmation, cancellation, no-show, and completion; acceptance alone is not treated as full confirmation.

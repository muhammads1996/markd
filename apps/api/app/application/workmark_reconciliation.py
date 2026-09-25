from typing import Any

SHARED_FACT_FIELDS = (
    "attendance",
    "completion",
    "payment",
    "amount_cents",
    "currency",
    "payment_method",
)


def _db_preference(value: str) -> str:
    return {
        "yes": "would_reuse",
        "no": "would_not_reuse",
        "unknown": "unknown",
    }[value]


def reconcile_workmark_evidence(
    stamps: list[dict[str, Any]], corrections: list[dict[str, Any]]
) -> dict[str, Any]:
    """Derive a Workmark without overwriting or promoting source assertions.

    A shared fact is authoritative only when worker and hirer agree on it, or
    when an operator correction explicitly names that fact. Unknown is absence
    of evidence. Bilateral reuse preferences are intentionally independent.
    """

    def shared_value(field: str) -> tuple[Any, bool, set[str]]:
        by_role: dict[str, set[Any]] = {}
        for stamp in stamps:
            value = stamp[field]
            if value is not None and value != "unknown":
                by_role.setdefault(str(stamp["asserted_role"]), set()).add(value)
        values = set().union(*by_role.values()) if by_role else set()
        return (
            next(iter(values)) if len(values) == 1 else None,
            len(values) > 1,
            set(by_role),
        )

    derived: dict[str, Any] = {}
    conflicts: set[str] = set()
    authoritative_fields: set[str] = set()
    known_shared_fields: set[str] = set()
    for field in SHARED_FACT_FIELDS:
        value, conflict, roles = shared_value(field)
        known = bool(roles)
        if known:
            known_shared_fields.add(field)
        if conflict:
            conflicts.add(field)
        if value is not None and roles == {"worker", "hirer"}:
            authoritative_fields.add(field)
        derived[field] = value

    for field in ("attendance", "completion", "payment"):
        if derived[field] is None:
            derived[field] = "unknown"

    for role, target in (
        ("worker", "worker_reuse_preference"),
        ("hirer", "organisation_reuse_preference"),
    ):
        values = {
            str(stamp["reuse_preference"])
            for stamp in stamps
            if stamp["asserted_role"] == role and stamp["reuse_preference"] != "unknown"
        }
        derived[target] = next(iter(values)) if len(values) == 1 else "unknown"
        if len(values) > 1:
            conflicts.add(target)

    corrected_fields: set[str] = set()
    latest_correction_at: dict[str, Any] = {}
    for correction in corrections:
        for key, value in correction["changes"].items():
            target = {
                "payment_state": "payment",
                "amount_minor": "amount_cents",
            }.get(key, key)
            if target not in derived:
                continue
            derived[target] = (
                _db_preference(value) if target.endswith("reuse_preference") else value
            )
            corrected_fields.add(target)
            authoritative_fields.add(target)
            conflicts.discard(target)
            latest_correction_at[target] = correction.get("created_at")

    # Corrections resolve the evidence available at that point in time. A later
    # participant claim is new evidence, not something a prior correction may
    # silently erase; it reopens the field for an exception/Ops decision.
    for field, corrected_at in latest_correction_at.items():
        if corrected_at is None:
            continue
        for stamp in stamps:
            asserted_at = stamp.get("created_at")
            value = stamp[field]
            if (
                asserted_at is not None
                and asserted_at > corrected_at
                and value is not None
                and value != "unknown"
                and value != derived[field]
            ):
                conflicts.add(field)

    unresolved_shared_fields = known_shared_fields - authoritative_fields
    if conflicts:
        evidence_state = "conflicted"
    elif corrected_fields and not unresolved_shared_fields:
        evidence_state = "operator_resolved"
    elif known_shared_fields and known_shared_fields <= authoritative_fields:
        evidence_state = "corroborated"
    else:
        evidence_state = "pending"

    derived.update(
        {
            "authoritative_fields": authoritative_fields,
            "conflicting_fields": conflicts,
            "unresolved_shared_fields": unresolved_shared_fields,
            "evidence_state": evidence_state,
        }
    )
    return derived

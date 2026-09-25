import uuid

import pytest

from app.api.v1.exceptions import (
    ExceptionClaimInput,
    OpenExceptionInput,
    ResolveExceptionInput,
    _claim_source,
    _resolve_assertion,
    _validate_category_context,
    resolve_exception_mutation,
)
from app.api.v1.proposed_actions import (
    PaymentIssueActionInput,
    _bound_payment_issue,
)
from app.core.auth import CurrentActor
from app.core.problems import ProblemDetail

WORKER_ID = uuid.UUID("99999999-9999-4999-8999-999999999999")
HIRER_ID = uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OTHER_ID = uuid.UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")


def operator() -> CurrentActor:
    return CurrentActor(
        user_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        claims={"operator": {"role": "ops_user", "person_id": None}},
    )


def participant(person_id: uuid.UUID, *, worker_scope: bool = False) -> CurrentActor:
    return CurrentActor(
        user_id=uuid.uuid4(),
        claims={"participant_person_id": str(person_id), "worker_scope": worker_scope},
    )


def assignment() -> dict[str, object]:
    return {
        "worker_id": WORKER_ID,
        "hirer_person_id": HIRER_ID,
        "hirer_person_ids": [HIRER_ID],
        "organisation_id": uuid.UUID("55555555-5555-4555-8555-555555555555"),
    }


def test_operator_can_capture_a_worker_statement_without_becoming_assertor() -> None:
    role, asserted_by = _resolve_assertion(
        operator(),
        assignment(),
        ExceptionClaimInput(
            asserted_by=WORKER_ID,
            asserted_role="worker",
            statement="I arrived but was sent home.",
            source="call",
        ),
    )

    assert role == "worker"
    assert asserted_by == WORKER_ID
    assert operator().user_id != asserted_by


@pytest.mark.parametrize(
    ("role", "asserted_by"),
    [("worker", OTHER_ID), ("hirer", OTHER_ID), ("operator", WORKER_ID)],
)
def test_operator_cannot_misattributed_claims(
    role: str, asserted_by: uuid.UUID
) -> None:
    with pytest.raises(ProblemDetail) as error:
        _resolve_assertion(
            operator(),
            assignment(),
            ExceptionClaimInput(
                asserted_by=asserted_by,
                asserted_role=role,  # type: ignore[arg-type]
                statement="A statement.",
            ),
        )

    assert error.value.code == "INVALID_ASSERTION_ACTOR"


def test_cancelled_after_travel_requires_assignment_evidence() -> None:
    with pytest.raises(ProblemDetail) as error:
        _validate_category_context(
            {
                "cancelled_after_travel_authorised": False,
                "travel_authorised_at": None,
                "travel_revoked_at": None,
            },
            "cancelled_after_travel_authorisation",
        )

    assert error.value.code == "TRAVEL_EVIDENCE_REQUIRED"


def test_worker_can_only_self_assert_worker_claim() -> None:
    role, asserted_by = _resolve_assertion(
        participant(WORKER_ID, worker_scope=True),
        assignment(),
        ExceptionClaimInput(statement="I attended."),
    )
    assert role == "worker"
    assert asserted_by == WORKER_ID


def test_hirer_can_only_self_assert_hirer_claim() -> None:
    role, asserted_by = _resolve_assertion(
        participant(HIRER_ID),
        assignment(),
        ExceptionClaimInput(statement="The work was not completed."),
    )
    assert role == "hirer"
    assert asserted_by == HIRER_ID


def test_unrelated_participant_is_denied() -> None:
    with pytest.raises(ProblemDetail) as error:
        _resolve_assertion(
            participant(OTHER_ID, worker_scope=True),
            assignment(),
            ExceptionClaimInput(statement="I attended."),
        )
    assert error.value.status_code == 403


def test_participant_cannot_spoof_asserted_person_or_role() -> None:
    with pytest.raises(ProblemDetail) as error:
        _resolve_assertion(
            participant(WORKER_ID, worker_scope=True),
            assignment(),
            ExceptionClaimInput(
                asserted_by=HIRER_ID,
                asserted_role="hirer",
                statement="I am the hirer.",
            ),
        )
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_participant_cannot_resolve() -> None:
    with pytest.raises(ProblemDetail) as error:
        await resolve_exception_mutation(
            object(),
            participant(WORKER_ID, worker_scope=True),
            uuid.uuid4(),
            ResolveExceptionInput(
                outcome="accepted",
                reason="Reviewed",
                expected_version=1,
            ),
        )
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_resolution_allows_assignment_workmark_correction_fallback() -> None:
    exception_id = uuid.uuid4()
    assignment_id = uuid.uuid4()
    correction_id = uuid.uuid4()
    workmark_id = uuid.uuid4()

    class Result:
        def __init__(self, row: dict[str, object]) -> None:
            self.row = row

        async def fetchone(self) -> dict[str, object]:
            return self.row

    class Connection:
        def __init__(self) -> None:
            self.calls = 0

        async def execute(self, _query: str, _params: tuple[object, ...]) -> Result:
            self.calls += 1
            if self.calls == 1:
                return Result(
                    {
                        "id": exception_id,
                        "assignment_id": assignment_id,
                        "workmark_id": None,
                        "state": "under_review",
                        "category": "payment_dispute",
                        "version": 2,
                        "resolution_outcome": None,
                        "resolution_reason": None,
                        "resolution_evidence": None,
                        "workmark_correction_id": None,
                    }
                )
            if self.calls == 2:
                return Result(
                    {"workmark_id": workmark_id, "assignment_id": assignment_id}
                )
            return Result(
                {
                    "id": exception_id,
                    "state": "resolved",
                    "category": "payment_dispute",
                    "version": 3,
                }
            )

    result = await resolve_exception_mutation(
        Connection(),
        operator(),
        exception_id,
        ResolveExceptionInput(
            outcome="evidence_reviewed",
            reason="The assignment Workmark correction was reviewed.",
            expected_version=2,
            workmark_correction_id=correction_id,
        ),
    )
    assert result.status_code == 200
    assert result.body["state"] == "resolved"


def test_public_models_reject_forged_provenance_and_interpretation() -> None:
    with pytest.raises(ValueError):
        ExceptionClaimInput.model_validate(
            {
                "statement": "Forged source",
                "source_channel_event_id": str(uuid.uuid4()),
            }
        )
    with pytest.raises(ValueError):
        OpenExceptionInput.model_validate(
            {
                "category": "payment_dispute",
                "summary": "Forged interpretation",
                "statement": "Claim",
                "interpretation": {"trusted": True},
            }
        )
    with pytest.raises(ValueError):
        ExceptionClaimInput.model_validate(
            {"statement": "Backdated source", "occurred_at": "2026-09-20T06:00:00Z"}
        )


def test_operator_claim_source_must_use_the_direct_command_allowlist() -> None:
    with pytest.raises(ProblemDetail) as error:
        _claim_source(
            operator(),
            ExceptionClaimInput(statement="Unknown source.", source="carrier_pigeon"),
            "ops",
            None,
        )
    assert error.value.code == "INVALID_SOURCE"


def test_travel_evidence_requires_post_travel_category() -> None:
    with pytest.raises(ProblemDetail) as error:
        _validate_category_context(
            {
                "cancelled_after_travel_authorised": True,
                "travel_authorised_at": None,
                "travel_revoked_at": None,
            },
            "cancelled_after_commitment",
        )
    assert error.value.code == "TRAVEL_CANCELLATION_CATEGORY_REQUIRED"


def test_whatsapp_payment_identity_cannot_be_reassigned() -> None:
    payload = {
        "entityIds": {
            "assignmentId": str(uuid.UUID("11111111-1111-4111-8111-111111111111")),
            "assertedById": str(WORKER_ID),
            "assertedRole": "worker",
        }
    }
    requested = PaymentIssueActionInput(
        assignment_id=uuid.UUID("22222222-2222-4222-8222-222222222222"),
        asserted_by=WORKER_ID,
        asserted_role="worker",
    )
    with pytest.raises(ProblemDetail) as error:
        _bound_payment_issue(payload, requested)
    assert error.value.code == "SOURCE_BINDING_MISMATCH"

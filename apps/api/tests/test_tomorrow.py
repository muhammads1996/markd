# ruff: noqa: E501
# Compact fixture dictionaries keep each derived-state scenario readable.
from app.api.v1.tomorrow import _projection


def assignment(**overrides):
    return {
        "id": "assignment-1", "lifecycle": "active", "offered_at": "2026-09-21T10:00:00Z",
        "worker_response": "pending", "contractor_confirmation": "pending",
        "travel_authorised_at": None, "reporting_mode": None,
        "reporting_place_text": None, "reporting_at": None,
        "communication_evidence": [], "review_evidence": [], "open_exceptions": [],
        **overrides,
    }


def request(assignments):
    return {
        "labour_request_id": "request-1",
        "requirements": [{"id": "requirement-1", "required_headcount": 3, "covered_headcount": 1, "remaining_gap": 2}],
        "assignments": assignments,
    }


def test_tomorrow_projection_reconciles_open_headcount_and_response_gap():
    result = _projection([request([assignment()])])
    assert result["summary"]["positions_required"] == 3
    assert result["summary"]["covered_positions"] == 1
    assert result["summary"]["open_positions"] == 2
    assert result["summary"]["waiting_worker_response"] == 1
    assert result["requests"][0]["assignments"][0]["bucket"] == "awaiting_worker_response"


def test_accepted_assignment_is_not_presented_as_travel_ready():
    result = _projection([request([assignment(worker_response="accepted")])])
    item = result["requests"][0]["assignments"][0]
    assert item["bucket"] == "accepted_waiting"
    assert item["travel_ready"] is False
    assert "Waiting for hirer confirmation" in item["blockers"]


def test_travel_authorisation_is_domain_truth_even_when_delivery_fails():
    result = _projection([request([assignment(
        worker_response="accepted", contractor_confirmation="confirmed",
        travel_authorised_at="2026-09-21T12:00:00Z", reporting_mode="pickup",
        reporting_place_text="Library", reporting_at="2026-09-22T05:00:00Z",
        communication_evidence=[{"id": "delivery-1", "state": "failed"}],
    )])])
    item = result["requests"][0]["assignments"][0]
    assert item["bucket"] == "travel_ready"
    assert item["travel_ready"] is True
    assert result["summary"]["communication_failures"] == 1


def test_revoked_travel_authorisation_is_not_travel_ready():
    result = _projection([request([assignment(
        worker_response="accepted", contractor_confirmation="confirmed",
        travel_authorised_at="2026-09-21T12:00:00Z",
        travel_revoked_at="2026-09-21T13:00:00Z", reporting_mode="site",
        reporting_place_text="Main gate", reporting_at="2026-09-22T05:00:00Z",
    )])])
    assert result["requests"][0]["assignments"][0]["travel_ready"] is False


def test_exception_and_semantic_review_are_indicators_not_assignment_state():
    result = _projection([request([assignment(
        open_exceptions=[{"id": "case-1", "state": "open"}],
        review_evidence=[{"id": "action-1", "semantic_mode": "shadow", "policy_reason": "Ops review"}],
    )])])
    item = result["requests"][0]["assignments"][0]
    assert item["bucket"] == "awaiting_worker_response"
    assert result["summary"]["open_exceptions"] == 1
    assert result["summary"]["review_required"] == 1


def test_pickup_reference_without_reporting_place_is_not_logistics_complete():
    result = _projection([request([assignment(
        worker_response="accepted", contractor_confirmation="confirmed",
        reporting_mode="pickup", pickup_point_id="point-1",
        reporting_at="2026-09-22T05:00:00Z",
    )])])
    item = result["requests"][0]["assignments"][0]
    assert item["bucket"] == "accepted_waiting"
    assert "Reporting or pickup details required" in item["blockers"]


def test_exception_blocks_authorise_action_even_when_other_facts_complete():
    result = _projection([request([assignment(
        worker_response="accepted", contractor_confirmation="confirmed",
        reporting_mode="site", reporting_place_text="Main gate",
        reporting_at="2026-09-22T05:00:00Z",
        open_exceptions=[{"id": "case-1", "state": "open"}],
    )])])
    assert result["requests"][0]["assignments"][0]["blockers"] == ["Open operational exception"]


def test_explicit_unavailability_is_warning_not_assignment_truth():
    result = _projection([request([assignment(
        worker_response="accepted", contractor_confirmation="confirmed",
        travel_authorised_at="2026-09-21T12:00:00Z",
        availability_status="unavailable",
    )])])
    item = result["requests"][0]["assignments"][0]
    assert item["travel_ready"] is True
    assert item["availability_conflict"] is True
    assert result["summary"]["availability_conflicts"] == 1


def test_cancelled_request_with_message_issue_is_not_scheduled_demand():
    cancelled = request([assignment(
        lifecycle="cancelled", offered_at=None,
        request_cancellation_outbox_followups=[{"id": "outbox-1", "state": "retrying"}],
    )])
    cancelled["lifecycle"] = "cancelled"
    result = _projection([cancelled])
    assert result["summary"]["labour_requests"] == 0
    assert result["summary"]["positions_required"] == 0
    assert result["summary"]["open_positions"] == 0
    assert result["summary"]["communication_failures"] == 1

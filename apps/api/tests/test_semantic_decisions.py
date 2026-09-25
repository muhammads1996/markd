from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.decisions.question_bundles import MESSAGE_ROUTING_V1
from app.decisions.semantic import (
    DecisionAnswer,
    DecisionResult,
    SemanticDecisionProviderError,
)
from app.decisions.service import SemanticDecisionService
from app.integrations.typesafe_jev import TypeSafeJevProvider
from app.workers import whatsapp as whatsapp_worker


def test_semantic_active_policy_rejects_out_of_range_threshold() -> None:
    with pytest.raises(ValidationError):
        Settings(semantic_decision_active_policy={"message_routing:AVAILABILITY:en": 2})


def _response_payload() -> dict[str, object]:
    answers: dict[str, object] = {}
    for question in MESSAGE_ROUTING_V1.questions:
        if question.kind == "choice":
            choice = next(iter(question.criteria))
            answers[question.key] = {
                "type": "choice",
                "choice": choice,
                "confidence": 0.96,
                "probabilities": {choice: 0.96},
            }
        else:
            answers[question.key] = {"type": "noul", "noul": 0.12}
    return {"model": "jev-1.13.0", "answers": answers, "usage": {}}


@pytest.mark.asyncio
async def test_jev_adapter_maps_batched_choice_and_noul_answers() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://typesafe.test/v1/systemone"
        assert request.headers["authorization"] == "Bearer test-key"
        body = json.loads(request.content)
        assert set(body["questions"]) == {
            question.key for question in MESSAGE_ROUTING_V1.questions
        }
        return httpx.Response(200, json=_response_payload())

    provider = TypeSafeJevProvider(
        "test-key",
        "https://typesafe.test",
        "jev-1.13.0",
        1,
        0,
        httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    try:
        result = await provider.evaluate(
            state={"message": "yes", "actorRole": "worker"},
            bundle=MESSAGE_ROUTING_V1,
        )
    finally:
        await provider.aclose()

    assert result.model == "jev-1.13.0"
    assert result.answers["message_class"].value == "AVAILABILITY"
    assert result.answers["message_class"].confidence == 0.96
    assert result.answers["transport_needed"].value == 0.12


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [429, 503])
async def test_jev_adapter_maps_retryable_http_failures(status: int) -> None:
    provider = TypeSafeJevProvider(
        "test-key",
        "https://typesafe.test",
        "jev-1.13.0",
        1,
        0,
        httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _: httpx.Response(status))
        ),
    )
    try:
        with pytest.raises(Exception) as error:
            await provider.evaluate(
                state={"message": "maybe"}, bundle=MESSAGE_ROUTING_V1
            )
    finally:
        await provider.aclose()
    assert getattr(error.value, "retryable") is True
    expected_kind = "rate_limit" if status == 429 else "http_error"
    assert getattr(error.value, "kind") == expected_kind


@pytest.mark.asyncio
async def test_jev_adapter_rejects_malformed_provider_response() -> None:
    provider = TypeSafeJevProvider(
        "test-key",
        "https://typesafe.test",
        "jev-1.13.0",
        1,
        0,
        httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json={"answers": {}})
            )
        ),
    )
    try:
        with pytest.raises(Exception) as error:
            await provider.evaluate(
                state={"message": "maybe"}, bundle=MESSAGE_ROUTING_V1
            )
    finally:
        await provider.aclose()
    assert getattr(error.value, "kind") == "invalid_response"


@pytest.mark.asyncio
async def test_jev_adapter_maps_non_json_success_response_to_safe_error() -> None:
    provider = TypeSafeJevProvider(
        "test-key",
        "https://typesafe.test",
        "jev-1.13.0",
        1,
        0,
        httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, content=b"not json")
            )
        ),
    )
    try:
        with pytest.raises(SemanticDecisionProviderError) as error:
            await provider.evaluate(
                state={"message": "maybe"}, bundle=MESSAGE_ROUTING_V1
            )
    finally:
        await provider.aclose()
    assert error.value.kind == "invalid_response"
    assert error.value.retryable is False


@pytest.mark.asyncio
async def test_jev_adapter_maps_timeout_without_a_partial_result() -> None:
    async def timeout(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out")

    provider = TypeSafeJevProvider(
        "test-key",
        "https://typesafe.test",
        "jev-1.13.0",
        1,
        0,
        httpx.AsyncClient(transport=httpx.MockTransport(timeout)),
    )
    try:
        with pytest.raises(SemanticDecisionProviderError) as error:
            await provider.evaluate(
                state={"message": "maybe"}, bundle=MESSAGE_ROUTING_V1
            )
    finally:
        await provider.aclose()
    assert error.value.kind == "timeout"
    assert error.value.retryable is True


class FakeConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    async def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.calls.append((query, params))


class FakeProvider:
    async def evaluate(self, *, state: dict[str, object], bundle: Any) -> Any:
        from app.decisions.semantic import DecisionAnswer, DecisionResult

        answers = {
            question.key: DecisionAnswer(
                question.key,
                "CLEAR" if question.key == "clarity" else next(iter(question.criteria)),
                0.97 if question.kind == "choice" else None,
                None,
            )
            for question in bundle.questions
        }
        return DecisionResult("fake", "fake-v1", answers, 4)


class FailingProvider:
    async def evaluate(self, *, state: dict[str, object], bundle: Any) -> Any:
        raise SemanticDecisionProviderError("rate_limit", True, "retry later")


class LowClassConfidenceProvider(FakeProvider):
    async def evaluate(self, *, state: dict[str, object], bundle: Any) -> Any:
        result = await super().evaluate(state=state, bundle=bundle)
        answer = result.answers["message_class"]
        result.answers["message_class"] = DecisionAnswer(
            answer.key, answer.value, 0.2, answer.probabilities
        )
        return result


@pytest.mark.asyncio
async def test_active_policy_is_language_specific_and_persists_hash_only() -> None:
    connection = FakeConnection()
    service = SemanticDecisionService(
        FakeProvider(),
        mode="active",
        active_policy={"message_routing:AVAILABILITY:en": 0.95},
    )
    evaluation = await service.evaluate_persisted_event(
        connection,
        channel_event_id="11111111-1111-4111-8111-111111111111",
        state={"message": "yes", "channel": "whatsapp"},
        bundle=MESSAGE_ROUTING_V1,
        language_code="en",
    )
    assert evaluation.policy.route == "baseline"
    assert connection.calls
    params = connection.calls[0][1]
    assert "yes" not in params
    assert len(str(params[5])) == 64

    uncalibrated = await service.evaluate_persisted_event(
        connection,
        channel_event_id="22222222-2222-4222-8222-222222222222",
        state={"message": "ja", "channel": "whatsapp"},
        bundle=MESSAGE_ROUTING_V1,
        language_code="af",
    )
    assert uncalibrated.policy.route == "confirmation_or_ops"


@pytest.mark.asyncio
async def test_active_policy_requires_selected_class_confidence() -> None:
    connection = FakeConnection()
    service = SemanticDecisionService(
        LowClassConfidenceProvider(),
        mode="active",
        active_policy={"message_routing:AVAILABILITY:en": 0.95},
    )
    evaluation = await service.evaluate_persisted_event(
        connection,
        channel_event_id="23232323-2323-4232-8232-232323232323",
        state={"message": "available", "channel": "whatsapp"},
        bundle=MESSAGE_ROUTING_V1,
        language_code="en",
    )
    assert evaluation.policy.route == "confirmation_or_ops"


@pytest.mark.asyncio
async def test_provider_failure_persists_failure_evidence_and_routes_safely() -> None:
    connection = FakeConnection()
    service = SemanticDecisionService(
        FailingProvider(), mode="shadow", active_policy={}
    )
    evaluation = await service.evaluate_persisted_event(
        connection,
        channel_event_id="33333333-3333-4333-8333-333333333333",
        state={"message": "I need pickup", "channel": "whatsapp"},
        bundle=MESSAGE_ROUTING_V1,
        language_code="en",
    )
    assert evaluation.result is None
    assert evaluation.failure_kind == "rate_limit"
    assert evaluation.policy.route == "baseline"
    assert connection.calls[0][1][-1] == "failed"


class FakeResult:
    def __init__(
        self,
        row: dict[str, object] | None = None,
        rows: list[dict[str, object]] | None = None,
    ) -> None:
        self._row = row
        self._rows = rows or []

    async def fetchone(self) -> dict[str, object] | None:
        return self._row

    async def fetchall(self) -> list[dict[str, object]]:
        return self._rows


class FakeProcessingConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...] | None]] = []
        self.event = {
            "id": "44444444-4444-4444-8444-444444444444",
            "event_type": "message",
            "provider_message_id": "wamid-semantic-1",
            "sender_phone_number": "+27821234567",
            "occurred_at": None,
            "payload": {
                "entry": [
                    {
                        "changes": [
                            {
                                "value": {
                                    "messages": [
                                        {
                                            "id": "wamid-semantic-1",
                                            "text": {"body": "I am available tomorrow"},
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                ]
            },
        }

    async def execute(
        self, query: str, params: tuple[object, ...] | None = None
    ) -> FakeResult:
        self.calls.append((query, params))
        if "from public.channel_events" in query:
            return FakeResult(self.event)
        if "claim_channel_processing_jobs" in query:
            return FakeResult(
                rows=[
                    {
                        "id": "55555555-5555-4555-8555-555555555555",
                        "channel_event_id": self.event["id"],
                    }
                ]
            )
        return FakeResult()


class FakeTransaction:
    def __init__(self, connection: FakeProcessingConnection) -> None:
        self.connection = connection

    async def __aenter__(self) -> FakeProcessingConnection:
        return self.connection

    async def __aexit__(self, *_: object) -> None:
        return None


class FakeDatabase:
    def __init__(self, connection: FakeProcessingConnection) -> None:
        self.connection = connection

    def service_transaction(self) -> FakeTransaction:
        return FakeTransaction(self.connection)


class FakeJevProvider:
    async def evaluate(
        self, *, state: dict[str, object], bundle: Any
    ) -> DecisionResult:
        answers = {
            question.key: DecisionAnswer(
                key=question.key,
                value=(
                    "AVAILABILITY"
                    if question.key == "message_class"
                    else "EXPLICIT_ACTION"
                    if question.key == "message_posture"
                    else "NEEDS_CONFIRMATION"
                    if question.key == "clarity"
                    else "UNCLEAR"
                    if question.kind == "choice"
                    else 0.0
                ),
                confidence=0.99 if question.kind == "choice" else None,
                probabilities=None,
            )
            for question in bundle.questions
        }
        return DecisionResult("typesafe_jev", "jev-test", answers, 7)

    async def aclose(self) -> None:
        return None


@pytest.mark.asyncio
async def test_persisted_message_job_records_shadow_evidence_before_proposed_action(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = FakeProcessingConnection()
    monkeypatch.setattr(
        whatsapp_worker, "_semantic_provider", lambda _: FakeJevProvider()
    )
    outcomes = await whatsapp_worker.run_processing_jobs(
        FakeDatabase(connection),  # type: ignore[arg-type]
        Settings(
            semantic_decision_enabled=True,
            semantic_decision_mode="shadow",
            typesafe_api_key="test-key",
            openrouter_api_key="",
        ),
    )
    assert outcomes == [
        {"job_id": "55555555-5555-4555-8555-555555555555", "outcome": "created"}
    ]
    queries = [query for query, _ in connection.calls]
    decision_index = next(
        index for index, query in enumerate(queries) if "semantic_decisions" in query
    )
    action_index = next(
        index for index, query in enumerate(queries) if "proposed_actions" in query
    )
    assert decision_index < action_index
    assert any("complete_channel_processing_job" in query for query in queries)

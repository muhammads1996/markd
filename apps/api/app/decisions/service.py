"""Application policy around semantic evidence, not domain authority."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from typing import Any, Literal

from psycopg.types.json import Jsonb

from app.decisions.semantic import (
    DecisionBundle,
    DecisionResult,
    SemanticDecisionProvider,
    SemanticDecisionProviderError,
)

DecisionMode = Literal["off", "shadow", "active"]


@dataclass(frozen=True)
class SemanticPolicyOutcome:
    route: Literal["baseline", "confirmation_or_ops", "ops"]
    reason: str


@dataclass(frozen=True)
class SemanticEvaluation:
    result: DecisionResult | None
    failure_kind: str | None
    policy: SemanticPolicyOutcome


class SemanticDecisionService:
    def __init__(
        self,
        provider: SemanticDecisionProvider,
        *,
        mode: DecisionMode,
        active_policy: dict[str, float],
    ) -> None:
        self._provider = provider
        self._mode = mode
        self._active_policy = active_policy

    async def evaluate_persisted_event(
        self,
        connection: Any,
        *,
        channel_event_id: str,
        state: dict[str, object],
        bundle: DecisionBundle,
        language_code: str | None,
    ) -> SemanticEvaluation:
        try:
            result = await self._provider.evaluate(state=state, bundle=bundle)
            policy = self._policy_for(result, bundle, language_code)
            await _persist_decision(
                connection,
                channel_event_id=channel_event_id,
                bundle=bundle,
                state=state,
                language_code=language_code,
                mode=self._mode,
                result=result,
                failure_kind=None,
                provider_name=_provider_name(self._provider),
                policy=policy,
            )
            return SemanticEvaluation(result, None, policy)
        except SemanticDecisionProviderError as error:
            policy = SemanticPolicyOutcome(
                "baseline" if self._mode == "shadow" else "confirmation_or_ops",
                error.kind,
            )
            await _persist_decision(
                connection,
                channel_event_id=channel_event_id,
                bundle=bundle,
                state=state,
                language_code=language_code,
                mode=self._mode,
                result=None,
                failure_kind=error.kind,
                provider_name=_provider_name(self._provider),
                policy=policy,
            )
            return SemanticEvaluation(None, error.kind, policy)

    def _policy_for(
        self,
        result: DecisionResult,
        bundle: DecisionBundle,
        language_code: str | None,
    ) -> SemanticPolicyOutcome:
        if self._mode != "active":
            return SemanticPolicyOutcome("baseline", "shadow_evidence_only")
        # Configuration is deliberately empty until the evaluation dataset has
        # established a calibrated language/use-case threshold.  A policy key is
        # e.g. "message_routing:AVAILABILITY:en"; there is no global threshold.
        message_class = result.answers.get("message_class")
        use_case = str(message_class.value) if message_class else (
            bundle.policy_metadata["purpose"]
        )
        key = f"{bundle.name}:{use_case}:{language_code or 'unknown'}"
        threshold = self._active_policy.get(key)
        if threshold is None:
            return SemanticPolicyOutcome("confirmation_or_ops", "uncalibrated_class")
        if not _answers_clear_and_calibrated(
            result, str(message_class.value) if message_class else None, threshold
        ):
            return SemanticPolicyOutcome("confirmation_or_ops", "not_clear_enough")
        # Active semantic routing may retain the existing normal route.  It may
        # never execute a command, authorise travel, or decide trust facts.
        if bundle.policy_metadata.get("risk") != "low":
            return SemanticPolicyOutcome("ops", "high_risk_draft_only")
        return SemanticPolicyOutcome("baseline", "calibrated_low_risk_route")


async def _persist_decision(
    connection: Any,
    *,
    channel_event_id: str,
    bundle: DecisionBundle,
    state: dict[str, object],
    language_code: str | None,
    mode: DecisionMode,
    result: DecisionResult | None,
    failure_kind: str | None,
    provider_name: str,
    policy: SemanticPolicyOutcome,
) -> None:
    answers = (
        {key: asdict(answer) for key, answer in result.answers.items()}
        if result
        else {}
    )
    metadata = {
        "providerRequestId": result.provider_request_id if result else None,
        "failureKind": failure_kind,
        "questionKeys": [question.key for question in bundle.questions],
        "purpose": bundle.policy_metadata.get("purpose"),
    }
    await connection.execute(
        """
        insert into public.semantic_decisions (
          channel_event_id, decision_provider, model_version, bundle_name,
          bundle_version, input_hash, language_code, mode, answers, metadata,
          duration_ms, policy_outcome, policy_reason, status
        ) values (
          %s::uuid, %s, %s, %s, %s, %s, %s, %s::public.semantic_decision_mode,
          %s, %s, %s, %s, %s, %s
        )
        """,
        (
            channel_event_id,
            result.provider if result else provider_name,
            result.model if result else None,
            bundle.name,
            bundle.version,
            _input_hash(state),
            language_code,
            mode,
            Jsonb(answers),
            Jsonb(metadata),
            result.latency_ms if result else None,
            policy.route,
            policy.reason,
            "succeeded" if result else "failed",
        ),
    )


def _input_hash(state: dict[str, object]) -> str:
    canonical = json.dumps(
        state, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _provider_name(provider: SemanticDecisionProvider) -> str:
    """Keep failure telemetry identifiable without requiring adapter-specific types."""
    configured_name = getattr(provider, "provider_name", None)
    if isinstance(configured_name, str) and configured_name:
        return configured_name
    return type(provider).__name__


def _answers_clear_and_calibrated(
    result: DecisionResult, message_class: str | None, threshold: float
) -> bool:
    """Require confidence for the selected route, not merely its clarity label."""
    required = ["clarity", "message_class"]
    if message_class == "ASSIGNMENT_RESPONSE":
        required.append("assignment_response")
    elif message_class == "LABOUR_REQUEST":
        required.append("labour_request_fields")
    for key in required:
        answer = result.answers.get(key)
        if answer is None or answer.confidence is None or answer.confidence < threshold:
            return False
    return result.answers["clarity"].value == "CLEAR"

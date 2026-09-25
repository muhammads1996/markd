"""TypeSafe System One adapter; no TypeSafe types leave this module."""

from __future__ import annotations

import asyncio
from time import perf_counter

import httpx

from app.decisions.semantic import (
    DecisionAnswer,
    DecisionBundle,
    DecisionResult,
    SemanticDecisionProviderError,
)


class TypeSafeJevProvider:
    provider_name = "typesafe_jev"

    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        timeout_seconds: float,
        max_retries: int,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not api_key.strip():
            raise ValueError("TypeSafe API key is required")
        self._api_key = api_key
        self._url = f"{base_url.rstrip('/')}/v1/systemone"
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._max_retries = max_retries
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def evaluate(
        self, *, state: dict[str, object], bundle: DecisionBundle
    ) -> DecisionResult:
        payload = {
            "model": self._model,
            "state": state,
            "questions": {
                question.key: {
                    "type": question.kind,
                    "instructions": question.instructions,
                    "criteria": question.criteria,
                }
                for question in bundle.questions
            },
        }
        for attempt in range(self._max_retries + 1):
            started = perf_counter()
            try:
                response = await self._client.post(
                    self._url,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=self._timeout_seconds,
                )
                if response.status_code >= 400:
                    retryable = (
                        response.status_code == 429 or response.status_code >= 500
                    )
                    error = SemanticDecisionProviderError(
                        "rate_limit" if response.status_code == 429 else "http_error",
                        retryable,
                        f"TypeSafe request failed with status {response.status_code}",
                    )
                    if retryable and attempt < self._max_retries:
                        await asyncio.sleep(0.2 * (attempt + 1))
                        continue
                    raise error
                try:
                    payload = response.json()
                except ValueError as error:
                    raise SemanticDecisionProviderError(
                        "invalid_response", False, "TypeSafe returned invalid JSON"
                    ) from error
                value = _parse_response(payload, bundle)
                return DecisionResult(
                    provider=self.provider_name,
                    model=value[0],
                    answers=value[1],
                    latency_ms=round((perf_counter() - started) * 1000),
                    provider_request_id=response.headers.get("x-request-id"),
                )
            except httpx.TimeoutException as error:
                provider_error = SemanticDecisionProviderError(
                    "timeout", True, "TypeSafe request timed out"
                )
                if attempt < self._max_retries:
                    await asyncio.sleep(0.2 * (attempt + 1))
                    continue
                raise provider_error from error
            except httpx.HTTPError as error:
                provider_error = SemanticDecisionProviderError(
                    "transport_error", True, "TypeSafe transport request failed"
                )
                if attempt < self._max_retries:
                    await asyncio.sleep(0.2 * (attempt + 1))
                    continue
                raise provider_error from error
        raise SemanticDecisionProviderError("unknown", True, "TypeSafe request failed")


def _parse_response(
    payload: object, bundle: DecisionBundle
) -> tuple[str, dict[str, DecisionAnswer]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("answers"), dict):
        raise SemanticDecisionProviderError(
            "invalid_response", False, "TypeSafe returned no answer map"
        )
    model = payload.get("model")
    if not isinstance(model, str) or not model:
        raise SemanticDecisionProviderError(
            "invalid_response", False, "TypeSafe returned no model version"
        )
    answers_payload = payload["answers"]
    answers: dict[str, DecisionAnswer] = {}
    for question in bundle.questions:
        raw = answers_payload.get(question.key)
        if not isinstance(raw, dict):
            raise SemanticDecisionProviderError(
                "invalid_response", False, f"TypeSafe omitted {question.key}"
            )
        if question.kind == "choice":
            value = raw.get("choice")
            if not isinstance(value, str) or value not in question.criteria:
                raise SemanticDecisionProviderError(
                    "invalid_response",
                    False,
                    f"TypeSafe returned invalid {question.key}",
                )
            confidence = _probability(raw.get("confidence"))
            probabilities = _probabilities(raw.get("probabilities"), question.criteria)
            answers[question.key] = DecisionAnswer(
                question.key, value, confidence, probabilities
            )
        else:
            value = _probability(raw.get("noul"))
            if value is None:
                raise SemanticDecisionProviderError(
                    "invalid_response",
                    False,
                    f"TypeSafe returned invalid {question.key}",
                )
            answers[question.key] = DecisionAnswer(question.key, value, None, None)
    return (model, answers)


def _probability(value: object) -> float | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    numeric = float(value)
    return numeric if 0 <= numeric <= 1 else None


def _probabilities(value: object, criteria: dict[str, str]) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None
    parsed: dict[str, float] = {}
    for key, probability in value.items():
        if key not in criteria or not isinstance(key, str):
            return None
        numeric = _probability(probability)
        if numeric is None:
            return None
        parsed[key] = numeric
    return parsed

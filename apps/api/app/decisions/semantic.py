"""Provider-neutral, evidence-only semantic decisions.

Semantic decisions classify bounded questions over already persisted channel
evidence.  They never carry an application command or domain mutation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

DecisionValue = str | float
QuestionKind = Literal["choice", "noul"]


@dataclass(frozen=True)
class DecisionQuestion:
    key: str
    kind: QuestionKind
    instructions: str
    criteria: dict[str, str]


@dataclass(frozen=True)
class DecisionBundle:
    name: str
    version: str
    questions: tuple[DecisionQuestion, ...]
    policy_metadata: dict[str, str]


@dataclass(frozen=True)
class DecisionAnswer:
    key: str
    value: DecisionValue
    confidence: float | None
    probabilities: dict[str, float] | None


@dataclass(frozen=True)
class DecisionResult:
    provider: str
    model: str
    answers: dict[str, DecisionAnswer]
    latency_ms: int
    provider_request_id: str | None = None


class SemanticDecisionProvider(Protocol):
    async def evaluate(
        self,
        *,
        state: dict[str, object],
        bundle: DecisionBundle,
    ) -> DecisionResult: ...


class SemanticDecisionProviderError(Exception):
    def __init__(self, kind: str, retryable: bool, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.retryable = retryable

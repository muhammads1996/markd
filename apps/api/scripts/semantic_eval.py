"""Run the synthetic FLO-133 multilingual Jev calibration set.

This script is deliberately read-only: it makes decision-provider calls but
does not write channel events, decisions, ProposedActions, or domain state.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from collections import defaultdict
from pathlib import Path
from statistics import median
from typing import Any

from app.core.config import get_settings
from app.decisions.question_bundles import (
    CLOSEOUT_EVIDENCE_V1,
    EXCEPTION_TRIAGE_V1,
    MESSAGE_ROUTING_V1,
)
from app.decisions.semantic import DecisionBundle
from app.integrations.language import (
    HeuristicLanguageDetector,
    LanguageCode,
    OpenRouterProvider,
    OpenRouterProviderError,
    extract_intent,
)
from app.integrations.typesafe_jev import TypeSafeJevProvider

DATASET = (
    Path(__file__).resolve().parents[1]
    / "app"
    / "evaluations"
    / "semantic_dataset.json"
)


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=DATASET)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    settings = get_settings()
    if not settings.typesafe_api_key:
        parser.error("TYPESAFE_API_KEY is required for a live semantic evaluation")
    cases = json.loads(args.dataset.read_text(encoding="utf-8"))
    if not isinstance(cases, list):
        parser.error("dataset must be a JSON array")
    provider = TypeSafeJevProvider(
        settings.typesafe_api_key,
        settings.semantic_decision_base_url,
        settings.semantic_decision_model,
        settings.semantic_decision_timeout_seconds,
        settings.semantic_decision_max_retries,
    )
    baseline_provider = _openrouter_baseline_provider(settings)
    try:
        observations = await _evaluate_cases(provider, baseline_provider, cases)
    finally:
        await provider.aclose()
        if baseline_provider:
            await baseline_provider.aclose()
    report = _report(observations)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        _print_report(report)
    return 0


async def _evaluate_cases(
    provider: TypeSafeJevProvider,
    baseline_provider: OpenRouterProvider | None,
    cases: list[object],
) -> list[dict[str, Any]]:
    semaphore = asyncio.Semaphore(5)
    observations = await asyncio.gather(
        *[
            _evaluate_case(provider, baseline_provider, case, semaphore)
            for case in cases
        ]
    )
    return [observation for observation in observations if observation is not None]


async def _evaluate_case(
    provider: TypeSafeJevProvider,
    baseline_provider: OpenRouterProvider | None,
    case: object,
    semaphore: asyncio.Semaphore,
) -> dict[str, Any] | None:
    detector = HeuristicLanguageDetector()
    if not isinstance(case, dict):
        return None
    expected = case.get("expected")
    message = case.get("message")
    normalised = case.get("normalised_decision_text")
    if not isinstance(expected, dict) or not isinstance(message, str):
        return None
    async with semaphore:
        direct = await _evaluate(provider, message, MESSAGE_ROUTING_V1)
        normalised_result = (
            await _evaluate(provider, normalised, MESSAGE_ROUTING_V1)
            if isinstance(normalised, str) and normalised != message
            else direct
        )
        language = detector.detect(message)
        baseline = await _baseline(
            baseline_provider,
            message,
            language.language_code if language else None,
        )
    direct_correct, direct_unsafe = _score(direct, expected)
    normalised_correct, normalised_unsafe = _score(normalised_result, expected)
    followup_bundle = _followup_bundle(expected)
    followup_expected = case.get("followup_expected")
    direct_followup = None
    normalised_followup = None
    if followup_bundle and isinstance(followup_expected, dict):
        direct_followup = await _evaluate(provider, message, followup_bundle)
        normalised_followup = (
            await _evaluate(provider, normalised, followup_bundle)
            if isinstance(normalised, str) and normalised != message
            else direct_followup
        )
    direct_followup_correct = (
        _score(direct_followup, followup_expected)[0]
        if direct_followup and isinstance(followup_expected, dict)
        else None
    )
    normalised_followup_correct = (
        _score(normalised_followup, followup_expected)[0]
        if normalised_followup and isinstance(followup_expected, dict)
        else None
    )
    return {
        "id": case.get("id"),
        "language": case.get("language", "unknown"),
        "message_class": case.get("message_class", "unknown"),
        "source": case.get("source", "text"),
        "direct": direct,
        "normalised": normalised_result,
        "direct_correct": direct_correct,
        "normalised_correct": normalised_correct,
        "direct_unsafe": direct_unsafe,
        "normalised_unsafe": normalised_unsafe,
        "direct_confirmation_or_ops": _needs_confirmation_or_ops(direct),
        "normalised_confirmation_or_ops": _needs_confirmation_or_ops(
            normalised_result
        ),
        "direct_expected_confidence": _expected_confidence(direct, expected),
        "normalised_expected_confidence": _expected_confidence(
            normalised_result, expected
        ),
        "direct_followup": direct_followup,
        "normalised_followup": normalised_followup,
        "followup_expected": followup_expected,
        "direct_followup_correct": direct_followup_correct,
        "normalised_followup_correct": normalised_followup_correct,
        "baseline": baseline,
        "baseline_expected": case.get("baseline", "ops"),
        "baseline_correct": baseline["action_type"] == case.get("baseline", "ops"),
        "expected": expected,
    }


def _openrouter_baseline_provider(settings: Any) -> OpenRouterProvider | None:
    if not settings.openrouter_api_key:
        return None
    return OpenRouterProvider(
        settings.openrouter_api_key,
        settings.openrouter_base_url,
        (settings.openrouter_intent_model, settings.openrouter_intent_fallback_model),
        (
            settings.openrouter_transcription_model,
            settings.openrouter_transcription_fallback_model,
        ),
        settings.openrouter_intent_max_tokens,
        settings.openrouter_transcription_max_tokens,
        settings.openrouter_intent_max_cost_usd,
        settings.openrouter_transcription_max_cost_usd,
    )


async def _baseline(
    provider: OpenRouterProvider | None,
    message: str,
    language_code: LanguageCode | None,
) -> dict[str, Any]:
    if provider:
        try:
            intent = await provider.extract_intent(message, language_code)
            return {
                "provider": "openrouter",
                "action_type": intent.action_type if intent else "ops",
                "confidence": intent.confidence if intent else None,
                "failure": None,
            }
        except OpenRouterProviderError as error:
            return {
                "provider": "openrouter",
                "action_type": "ops",
                "confidence": None,
                "failure": type(error).__name__,
            }
    intent = extract_intent(message, language_code)
    return {
        "provider": "heuristic",
        "action_type": intent.action_type if intent else "ops",
        "confidence": intent.confidence if intent else None,
        "failure": None,
    }


async def _evaluate(
    provider: TypeSafeJevProvider, message: str, bundle: DecisionBundle
) -> dict[str, Any]:
    try:
        result = await provider.evaluate(
            state={"message": message, "channel": "whatsapp", "actorRole": "unknown"},
            bundle=bundle,
        )
        return {
            "answers": {key: answer.value for key, answer in result.answers.items()},
            "confidence": {
                key: answer.confidence for key, answer in result.answers.items()
            },
            "latency_ms": result.latency_ms,
            "failure": None,
        }
    except Exception as error:
        return {
            "answers": {},
            "confidence": {},
            "latency_ms": None,
            "failure": type(error).__name__,
        }


def _score(result: dict[str, Any], expected: dict[str, Any]) -> tuple[bool, bool]:
    answers = result["answers"]
    correct = result["failure"] is None and all(
        _matches(answers.get(key), value) for key, value in expected.items()
    )
    # An unsafe false positive is a clear/explicit acceptance or labour request
    # when the labelled case is ambiguous, irrelevant, or needs human handling.
    unsafe = (
        answers.get("clarity") == "CLEAR"
        and expected.get("clarity") in {"NEEDS_CONFIRMATION", "NEEDS_HUMAN"}
    ) or (
        answers.get("assignment_response") == "ACCEPT"
        and expected.get("assignment_response") not in {None, "ACCEPT"}
    )
    return correct, unsafe


def _matches(actual: object, expected: object) -> bool:
    if isinstance(expected, bool) and isinstance(actual, (int, float)):
        return (actual >= 0.5) is expected
    return actual == expected


def _needs_confirmation_or_ops(result: dict[str, Any]) -> bool:
    return result["failure"] is not None or result["answers"].get("clarity") != "CLEAR"


def _expected_confidence(result: dict[str, Any], expected: dict[str, Any]) -> float | None:
    values: list[float] = []
    answers = result["answers"]
    confidence = result["confidence"]
    for key, value in expected.items():
        if isinstance(value, bool):
            probability = answers.get(key)
            if isinstance(probability, (int, float)):
                values.append(float(probability) if value else 1 - float(probability))
        elif isinstance(confidence.get(key), (int, float)):
            values.append(float(confidence[key]))
    return sum(values) / len(values) if values else None


def _followup_bundle(expected: dict[str, Any]) -> DecisionBundle | None:
    message_class = expected.get("message_class")
    if message_class in {"EXCEPTION", "PAYMENT"}:
        return EXCEPTION_TRIAGE_V1
    if message_class == "CLOSEOUT":
        return CLOSEOUT_EVIDENCE_V1
    return None


def _report(observations: list[dict[str, Any]]) -> dict[str, Any]:
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for observation in observations:
        key = (observation["language"], observation["message_class"])
        groups[key].append(observation)
    rows: list[dict[str, Any]] = []
    for (language, message_class), group in sorted(groups.items()):
        direct_latencies = [
            item["direct"]["latency_ms"]
            for item in group
            if item["direct"]["latency_ms"] is not None
        ]
        normalised_latencies = [
            item["normalised"]["latency_ms"]
            for item in group
            if item["normalised"]["latency_ms"] is not None
        ]
        rows.append(
            {
                "language": language,
                "message_class": message_class,
                "cases": len(group),
                "direct_correct": sum(item["direct_correct"] for item in group),
                "normalised_correct": sum(item["normalised_correct"] for item in group),
                "baseline_correct": sum(item["baseline_correct"] for item in group),
                "direct_unsafe_false_positives": sum(
                    item["direct_unsafe"] for item in group
                ),
                "normalised_unsafe_false_positives": sum(
                    item["normalised_unsafe"] for item in group
                ),
                "direct_confirmation_or_ops": sum(
                    item["direct_confirmation_or_ops"] for item in group
                ),
                "normalised_confirmation_or_ops": sum(
                    item["normalised_confirmation_or_ops"] for item in group
                ),
                "direct_expected_confidence": _median_optional(
                    [item["direct_expected_confidence"] for item in group]
                ),
                "normalised_expected_confidence": _median_optional(
                    [item["normalised_expected_confidence"] for item in group]
                ),
                "followup_cases": sum(
                    item["direct_followup_correct"] is not None for item in group
                ),
                "direct_followup_correct": sum(
                    item["direct_followup_correct"] is True for item in group
                ),
                "normalised_followup_correct": sum(
                    item["normalised_followup_correct"] is True for item in group
                ),
                "direct_failures": sum(
                    item["direct"]["failure"] is not None for item in group
                ),
                "normalised_failures": sum(
                    item["normalised"]["failure"] is not None for item in group
                ),
                "baseline_failures": sum(
                    item["baseline"]["failure"] is not None for item in group
                ),
                "direct_median_latency_ms": (
                    int(median(direct_latencies)) if direct_latencies else None
                ),
                "normalised_median_latency_ms": (
                    int(median(normalised_latencies)) if normalised_latencies else None
                ),
            }
        )
    return {"cases": len(observations), "rows": rows}


def _median_optional(values: list[float | None]) -> float | None:
    numeric = [value for value in values if value is not None]
    return round(float(median(numeric)), 3) if numeric else None


def _print_report(report: dict[str, Any]) -> None:
    print(
        "language/message class | cases | direct | normalised | baseline | "
        "unsafe(d/n) | confirm/ops(d/n) | confidence(d/n) | followup(d/n) | median latency(d/n)"
    )
    for row in report["rows"]:
        print(
            f"{row['language']}/{row['message_class']} | {row['cases']} | "
            f"{row['direct_correct']} | {row['normalised_correct']} | "
            f"{row['baseline_correct']} | "
            f"{row['direct_unsafe_false_positives']}/"
            f"{row['normalised_unsafe_false_positives']} | "
            f"{row['direct_confirmation_or_ops']}/"
            f"{row['normalised_confirmation_or_ops']} | "
            f"{row['direct_expected_confidence']}/"
            f"{row['normalised_expected_confidence']} | "
            f"{row['direct_followup_correct']}/"
            f"{row['normalised_followup_correct']} | "
            f"{row['direct_median_latency_ms']}/{row['normalised_median_latency_ms']}"
        )


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

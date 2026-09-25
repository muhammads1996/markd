from __future__ import annotations

import json
from pathlib import Path


def test_semantic_evaluation_dataset_has_required_sanitised_coverage() -> None:
    dataset = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "evaluations"
        / "semantic_dataset.json"
    )
    cases = json.loads(dataset.read_text(encoding="utf-8"))
    assert len(cases) >= 25
    languages = {case["language"] for case in cases}
    assert {"en", "af", "xh", "code_switched"} <= languages
    assert any(case.get("source") == "voice_transcript" for case in cases)
    message_classes = {case.get("message_class", "unknown") for case in cases}
    assert {
        "availability",
        "assignment_response",
        "labour_request",
        "closeout",
        "exception",
        "ambiguous",
        "irrelevant",
    } <= message_classes
    followup_values = [case.get("followup_expected", {}).values() for case in cases]
    assert any("ATTENDANCE_DISPUTE" in values for values in followup_values)
    assert any("PAYMENT_DISPUTE" in values for values in followup_values)
    assert any(
        case.get("followup_expected")
        for case in cases
        if case["message_class"] == "closeout"
    )
    assert all("Sipho" not in case["message"] for case in cases)

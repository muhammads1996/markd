from datetime import date
from typing import Any

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.messaging.templates import (
    ASSIGNMENT_OFFER_BUTTON_PAYLOADS,
    ApprovedTemplatePayload,
    TemplateKey,
    build_template_payload,
    parse_message_payload,
    resolve_meta_template,
)

KEY_VARIABLES: dict[TemplateKey, dict[str, Any]] = {
    "assignment_offer_do_not_travel": {
        "work_date": date(2026, 9, 25),
        "site_area": "Cape Town",
    },
    "assignment_accepted_waiting": {"work_date": date(2026, 9, 25)},
    "assignment_travel_ready": {
        "reporting_at": "2026-09-25T06:30:00+02:00",
        "reporting_place_text": "Depot gate",
    },
    "assignment_changed": {"work_date": date(2026, 9, 25)},
    "assignment_cancelled": {"work_date": date(2026, 9, 25)},
    "pickup_reminder": {
        "reporting_at": "2026-09-25T06:30:00+02:00",
        "reporting_place_text": "Depot gate",
    },
    "payment_followup": {
        "work_date": date(2026, 9, 25),
        "amount_minor": 12345,
        "currency": "ZAR",
    },
    "exception_followup": {"case_reference": "EX-204"},
}
LOCALES = ("en", "af", "xh")
CATALOG = {
    key: {locale: f"approved_{key}_{locale}" for locale in LOCALES}
    for key in KEY_VARIABLES
}


@pytest.mark.parametrize(
    ("key", "locale"),
    [(key, locale) for key in KEY_VARIABLES for locale in LOCALES],
)
def test_every_template_key_and_locale_resolves(key: TemplateKey, locale: str) -> None:
    payload: ApprovedTemplatePayload = build_template_payload(
        key, locale, KEY_VARIABLES[key]
    )
    parsed = parse_message_payload(payload.model_dump(mode="json"))
    assert parsed == payload
    resolved = resolve_meta_template(payload, CATALOG)
    assert resolved.name == f"approved_{key}_{locale}"
    assert resolved.language_code == locale


def test_payload_rejects_wrong_or_extra_variables() -> None:
    with pytest.raises(ValidationError):
        build_template_payload(
            "assignment_offer_do_not_travel", "en", {"work_date": "2026-09-25"}
        )
    with pytest.raises(ValidationError):
        parse_message_payload({"type": "session_text", "body": "Hi", "other": "no"})
    with pytest.raises(ValidationError):
        build_template_payload(
            "assignment_accepted_waiting",
            "en",
            {"work_date": date(2026, 9, 25), "site_area": "unexpected"},
        )


def test_session_text_payload_is_discriminated_and_bounded() -> None:
    assert (
        parse_message_payload({"type": "session_text", "body": "Hello"}).type
        == "session_text"
    )
    with pytest.raises(ValidationError):
        parse_message_payload({"type": "session_text", "body": "   "})


def test_travel_ready_requires_offset_aware_reporting_datetime() -> None:
    with pytest.raises(ValidationError):
        build_template_payload(
            "assignment_travel_ready",
            "en",
            {"reporting_at": "2026-09-25T06:30:00", "reporting_place_text": "Gate"},
        )


def test_template_resolution_fails_closed_and_uses_en_fallback() -> None:
    payload = build_template_payload(
        "assignment_accepted_waiting",
        "af",
        KEY_VARIABLES["assignment_accepted_waiting"],
    )
    template = resolve_meta_template(
        payload, {"assignment_accepted_waiting": {"en": "approved_waiting_en"}}
    )
    assert template.name == "approved_waiting_en"
    assert template.language_code == "en"
    with pytest.raises(ValueError, match="No approved Meta template"):
        resolve_meta_template(payload, {})


def test_template_components_have_fixed_order_and_formatting() -> None:
    offer = build_template_payload(
        "assignment_offer_do_not_travel",
        "en",
        KEY_VARIABLES["assignment_offer_do_not_travel"],
    )
    assert resolve_meta_template(offer, CATALOG).components == [
        {
            "type": "body",
            "parameters": [
                {"type": "text", "text": "2026-09-25"},
                {"type": "text", "text": "Cape Town"},
            ],
        },
        *[
            {
                "type": "button",
                "sub_type": "quick_reply",
                "index": str(index),
                "parameters": [{"type": "payload", "payload": payload_id}],
            }
            for index, payload_id in enumerate(ASSIGNMENT_OFFER_BUTTON_PAYLOADS)
        ],
    ]
    payment = build_template_payload(
        "payment_followup", "en", KEY_VARIABLES["payment_followup"]
    )
    assert (
        resolve_meta_template(payment, CATALOG).components[0]["parameters"][1]["text"]
        == "ZAR 123.45"
    )
    travel = build_template_payload(
        "assignment_travel_ready", "en", KEY_VARIABLES["assignment_travel_ready"]
    )
    assert (
        resolve_meta_template(travel, CATALOG).components[0]["parameters"][0]["text"]
        == "2026-09-25 06:30"
    )


def test_settings_accepts_template_catalog_json() -> None:
    settings = Settings(whatsapp_template_catalog=CATALOG)
    assert (
        settings.whatsapp_template_catalog["assignment_travel_ready"]["en"]
        == "approved_assignment_travel_ready_en"
    )
    assert settings.whatsapp_template_fallback_locale == "en"
    with pytest.raises(ValidationError):
        Settings(whatsapp_template_fallback_locale="fr")

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator

from app.integrations.whatsapp import ApprovedTemplate

Locale = Literal["en", "af", "xh"]
ASSIGNMENT_OFFER_BUTTON_PAYLOADS = (
    "MARKD_ASSIGNMENT_YES",
    "MARKD_ASSIGNMENT_NO",
    "MARKD_ASSIGNMENT_CALL_ME",
)
TemplateKey = Literal[
    "assignment_offer_do_not_travel",
    "assignment_accepted_waiting",
    "assignment_travel_ready",
    "assignment_changed",
    "assignment_cancelled",
    "pickup_reminder",
    "payment_followup",
    "exception_followup",
]


class _Payload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SessionTextPayload(_Payload):
    type: Literal["session_text"]
    body: str = Field(min_length=1, max_length=4096, strict=True)

    @field_validator("body")
    @classmethod
    def non_blank_body(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("body must not be blank")
        return value


class AssignmentOfferVariables(_Payload):
    work_date: date
    site_area: str = Field(min_length=1, max_length=120, strict=True)


class AcceptedWaitingVariables(_Payload):
    work_date: date


class TravelReadyVariables(_Payload):
    reporting_at: datetime
    reporting_place_text: str = Field(min_length=1, max_length=200, strict=True)

    @field_validator("reporting_at")
    @classmethod
    def reporting_time_must_have_offset(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("reporting_at must include a timezone offset")
        return value


class AssignmentChangedVariables(_Payload):
    work_date: date


class AssignmentCancelledVariables(_Payload):
    work_date: date


class PickupReminderVariables(_Payload):
    reporting_at: datetime
    reporting_place_text: str = Field(min_length=1, max_length=200, strict=True)

    @field_validator("reporting_at")
    @classmethod
    def reporting_time_must_have_offset(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("reporting_at must include a timezone offset")
        return value


class PaymentFollowupVariables(_Payload):
    work_date: date
    amount_minor: int = Field(ge=0, strict=True)
    currency: str = Field(pattern=r"^[A-Z]{3}$", strict=True)


class ExceptionFollowupVariables(_Payload):
    case_reference: str = Field(min_length=1, max_length=80, strict=True)


class AssignmentOfferPayload(_Payload):
    type: Literal["approved_template"]
    key: Literal["assignment_offer_do_not_travel"]
    locale: Locale
    variables: AssignmentOfferVariables


class AcceptedWaitingPayload(_Payload):
    type: Literal["approved_template"]
    key: Literal["assignment_accepted_waiting"]
    locale: Locale
    variables: AcceptedWaitingVariables


class TravelReadyPayload(_Payload):
    type: Literal["approved_template"]
    key: Literal["assignment_travel_ready"]
    locale: Locale
    variables: TravelReadyVariables


class AssignmentChangedPayload(_Payload):
    type: Literal["approved_template"]
    key: Literal["assignment_changed"]
    locale: Locale
    variables: AssignmentChangedVariables


class AssignmentCancelledPayload(_Payload):
    type: Literal["approved_template"]
    key: Literal["assignment_cancelled"]
    locale: Locale
    variables: AssignmentCancelledVariables


class PickupReminderPayload(_Payload):
    type: Literal["approved_template"]
    key: Literal["pickup_reminder"]
    locale: Locale
    variables: PickupReminderVariables


class PaymentFollowupPayload(_Payload):
    type: Literal["approved_template"]
    key: Literal["payment_followup"]
    locale: Locale
    variables: PaymentFollowupVariables


class ExceptionFollowupPayload(_Payload):
    type: Literal["approved_template"]
    key: Literal["exception_followup"]
    locale: Locale
    variables: ExceptionFollowupVariables


ApprovedTemplatePayload: TypeAlias = Annotated[
    AssignmentOfferPayload
    | AcceptedWaitingPayload
    | TravelReadyPayload
    | AssignmentChangedPayload
    | AssignmentCancelledPayload
    | PickupReminderPayload
    | PaymentFollowupPayload
    | ExceptionFollowupPayload,
    Field(discriminator="key"),
]
MessagePayload: TypeAlias = SessionTextPayload | ApprovedTemplatePayload
_PAYLOAD_ADAPTER: TypeAdapter[MessagePayload] = TypeAdapter(MessagePayload)
_TEMPLATE_ADAPTER: TypeAdapter[ApprovedTemplatePayload] = TypeAdapter(
    ApprovedTemplatePayload
)


_KEY_MODELS: dict[str, type[BaseModel]] = {
    "assignment_offer_do_not_travel": AssignmentOfferVariables,
    "assignment_accepted_waiting": AcceptedWaitingVariables,
    "assignment_travel_ready": TravelReadyVariables,
    "assignment_changed": AssignmentChangedVariables,
    "assignment_cancelled": AssignmentCancelledVariables,
    "pickup_reminder": PickupReminderVariables,
    "payment_followup": PaymentFollowupVariables,
    "exception_followup": ExceptionFollowupVariables,
}


def parse_message_payload(raw: Any) -> MessagePayload:
    """Validate persisted/outbox payload data against the closed payload contract."""
    return _PAYLOAD_ADAPTER.validate_python(raw)


def build_template_payload(
    key: TemplateKey, locale: Locale, variables: dict[str, Any]
) -> ApprovedTemplatePayload:
    """Build a strictly typed payload using only the variables allowed for its key."""
    variable_model = _KEY_MODELS[key]
    validated_variables = variable_model.model_validate(variables)
    return _TEMPLATE_ADAPTER.validate_python(
        {
            "type": "approved_template",
            "key": key,
            "locale": locale,
            "variables": validated_variables.model_dump(),
        }
    )


def resolve_meta_template(
    payload: ApprovedTemplatePayload,
    catalog: dict[str, dict[str, str | dict[str, str]]],
    fallback_locale: Locale = "en",
) -> ApprovedTemplate:
    """Resolve a configured approved Meta template and fixed ordered components."""
    localized = catalog.get(payload.key, {})
    entry = localized.get(payload.locale) or localized.get(fallback_locale)
    if entry is None:
        raise ValueError(f"No approved Meta template configured for {payload.key}")
    if isinstance(entry, str):
        name = entry
        language_code: str = (
            payload.locale if payload.locale in localized else fallback_locale
        )
    else:
        name = entry.get("name", "")
        language_code = entry.get(
            "language_code",
            payload.locale if payload.locale in localized else fallback_locale,
        )
    if not name.strip() or not language_code.strip():
        raise ValueError(f"Invalid approved Meta template mapping for {payload.key}")
    values = _ordered_variable_values(payload)
    components = (
        [
            {
                "type": "body",
                "parameters": [{"type": "text", "text": value} for value in values],
            }
        ]
        if values
        else []
    )
    if payload.key == "assignment_offer_do_not_travel":
        components.extend(
            {
                "type": "button",
                "sub_type": "quick_reply",
                "index": str(index),
                "parameters": [{"type": "payload", "payload": button_payload}],
            }
            for index, button_payload in enumerate(ASSIGNMENT_OFFER_BUTTON_PAYLOADS)
        )
    return ApprovedTemplate(
        name=name, language_code=language_code, components=components
    )


def render_session_text(payload: ApprovedTemplatePayload) -> SessionTextPayload:
    """Fixed participant copy from the same validated canonical facts."""
    locale = payload.locale
    date_value = (
        _ordered_variable_values(payload)[0]
        if payload.key
        in {
            "assignment_offer_do_not_travel",
            "assignment_accepted_waiting",
            "assignment_changed",
            "assignment_cancelled",
            "payment_followup",
        }
        else None
    )
    if isinstance(payload, AssignmentOfferPayload):
        copy = {
            "en": (
                f"Work offer: {date_value}, {payload.variables.site_area}. "
                "DO NOT TRAVEL YET. Reply YES to take the job, "
                "NO if you cannot go, or CALL ME."
            ),
            "af": (
                f"Werksaanbod: {date_value}, {payload.variables.site_area}. "
                "MOENIE NOG REIS NIE. Antwoord JA om die werk te vat, "
                "NEE as jy nie kan gaan nie, of BEL MY."
            ),
            "xh": (
                f"Isinikezelo somsebenzi: {date_value}, "
                f"{payload.variables.site_area}. MUSA UKUHAMBA OKWANGOKU. "
                "Phendula EWE ukuze wamkele umsebenzi, HAYI xa "
                "ungenakuya, okanye NDIFOWUNELE."
            ),
        }
    elif isinstance(payload, AcceptedWaitingPayload):
        copy = {
            "en": (
                f"You accepted the work on {date_value}. "
                "The work is not yet confirmed. DO NOT TRAVEL YET."
            ),
            "af": (
                f"Jy het die werk op {date_value} aanvaar. "
                "Die werk is nog nie bevestig nie. MOENIE NOG REIS NIE."
            ),
            "xh": (
                f"Uwamkele umsebenzi ngomhla we-{date_value}. "
                "Umsebenzi awukaqinisekiswa. MUSA UKUHAMBA OKWANGOKU."
            ),
        }
    elif isinstance(payload, (TravelReadyPayload, PickupReminderPayload)):
        facts = (
            f"{_format_time(payload.variables.reporting_at)}, "
            f"{payload.variables.reporting_place_text}"
        )
        if payload.key == "assignment_travel_ready":
            copy = {
                "en": f"Work confirmed. YOU CAN TRAVEL. Report at {facts}.",
                "af": f"Werk bevestig. JY KAN REIS. Meld aan by {facts}.",
                "xh": f"Umsebenzi uqinisekisiwe. UNGANGENA ENDLELENI. Fika e-{facts}.",
            }
        else:
            copy = {
                "en": f"Pickup reminder: {facts}.",
                "af": f"Optelherinnering: {facts}.",
                "xh": f"Isikhumbuzo sokulandwa: {facts}.",
            }
    elif isinstance(payload, AssignmentChangedPayload):
        copy = {
            "en": (
                f"Work details changed for {date_value}. "
                "Wait for updated instructions. DO NOT TRAVEL YET."
            ),
            "af": (
                f"Werkbesonderhede vir {date_value} het verander. "
                "Wag vir nuwe instruksies. MOENIE NOG REIS NIE."
            ),
            "xh": (
                f"Iinkcukacha zomsebenzi ka-{date_value} zitshintshile. "
                "Linda imiyalelo emitsha. MUSA UKUHAMBA OKWANGOKU."
            ),
        }
    elif isinstance(payload, AssignmentCancelledPayload):
        copy = {
            "en": f"Work on {date_value} is cancelled. DO NOT TRAVEL.",
            "af": f"Werk op {date_value} is gekanselleer. MOENIE REIS NIE.",
            "xh": f"Umsebenzi ka-{date_value} urhoxisiwe. MUSA UKUHAMBA.",
        }
    elif isinstance(payload, PaymentFollowupPayload):
        amount = _ordered_variable_values(payload)[1]
        message = (
            f"Payment follow-up for work on {date_value}: {amount}. "
            "Please contact MARKD if this is incorrect."
        )
        copy = {code: message for code in ("en", "af", "xh")}
    else:
        assert isinstance(payload, ExceptionFollowupPayload)
        message = (
            f"MARKD exception follow-up: {payload.variables.case_reference}. "
            "Please contact MARKD."
        )
        copy = {code: message for code in ("en", "af", "xh")}
    return SessionTextPayload(type="session_text", body=copy[locale])


def _ordered_variable_values(payload: ApprovedTemplatePayload) -> list[str]:
    if isinstance(payload, AssignmentOfferPayload):
        return [_format_date(payload.variables.work_date), payload.variables.site_area]
    if isinstance(
        payload,
        (AcceptedWaitingPayload, AssignmentChangedPayload, AssignmentCancelledPayload),
    ):
        return [_format_date(payload.variables.work_date)]
    if isinstance(payload, (TravelReadyPayload, PickupReminderPayload)):
        return [
            _format_time(payload.variables.reporting_at),
            payload.variables.reporting_place_text,
        ]
    if isinstance(payload, PaymentFollowupPayload):
        whole, cents = divmod(payload.variables.amount_minor, 100)
        return [
            _format_date(payload.variables.work_date),
            f"{payload.variables.currency} {whole}.{cents:02d}",
        ]
    assert isinstance(payload, ExceptionFollowupPayload)
    return [payload.variables.case_reference]


def _format_date(value: date) -> str:
    return value.isoformat()


def _format_time(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M")

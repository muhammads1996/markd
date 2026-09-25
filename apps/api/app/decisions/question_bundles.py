"""Versioned, reviewable Jev question bundles.

Question wording is deliberately centralised.  The values are routing and
draft-evidence labels only; they are not MARKD domain facts.
"""

from app.decisions.semantic import DecisionBundle, DecisionQuestion

MESSAGE_ROUTING_V1 = DecisionBundle(
    name="message_routing",
    version="v1",
    policy_metadata={"risk": "low", "purpose": "route_only"},
    questions=(
        DecisionQuestion(
            "message_class",
            "choice",
            (
                "Choose the best bounded MARKD message class. "
                "Do not infer unstated facts."
            ),
            {
                "AVAILABILITY": "A participant says whether they can work.",
                "ASSIGNMENT_RESPONSE": "A response to a specific work offer.",
                "LABOUR_REQUEST": "A contractor asks for workers.",
                "LOGISTICS": "Transport, pickup, reporting, or travel coordination.",
                "CLOSEOUT": "End-of-work attendance or completion information.",
                "PAYMENT": "Payment concern or payment follow-up.",
                "EXCEPTION": "A dispute, cancellation, or trust concern.",
                "HELP": "A request for assistance or a call without a business action.",
                "UNSUPPORTED": "General chat, irrelevant content, or no class above.",
            },
        ),
        DecisionQuestion(
            "message_posture",
            "choice",
            "Is this an explicit participant action or only context/chatter?",
            {
                "EXPLICIT_ACTION": (
                    "It directly requests, accepts, declines, or reports."
                ),
                "CONTEXT_ONLY": "It supplies context or chatter without an action.",
                "UNCLEAR": "The intended action is not clear.",
            },
        ),
        DecisionQuestion(
            "clarity",
            "choice",
            "How safely can this message enter MARKD's ordinary routing path?",
            {
                "CLEAR": "Intent is clear; exact values still require code parsing.",
                "NEEDS_CONFIRMATION": (
                    "A short confirmation or missing field is needed."
                ),
                "NEEDS_HUMAN": "The message is ambiguous or needs operator review.",
            },
        ),
        DecisionQuestion(
            "assignment_response",
            "choice",
            (
                "If this is an assignment response, choose its meaning. "
                "Otherwise choose UNCLEAR."
            ),
            {
                "ACCEPT": "The participant accepts; this never makes travel ready.",
                "DECLINE": "The participant cannot or does not want to take the offer.",
                "REQUEST_CALL": "The participant asks to be called or needs a call.",
                "CONDITIONAL": "Participation depends on a condition, such as pickup.",
                "UNCLEAR": "No reliable assignment response is expressed.",
            },
        ),
        DecisionQuestion(
            "transport_needed",
            "noul",
            "Does the participant explicitly need transport or pickup?",
            {
                "true": "Transport or pickup is explicitly needed.",
                "false": "It is not explicitly needed.",
            },
        ),
        DecisionQuestion(
            "labour_request_fields",
            "choice",
            (
                "For a labour request, assess field presence. "
                "Do not extract or calculate values."
            ),
            {
                "COMPLETE_ENOUGH": "Category, count, place, and date appear present.",
                "MISSING_INFORMATION": "It is a labour request missing a key field.",
                "NOT_A_LABOUR_REQUEST": "It is not a labour request.",
            },
        ),
    ),
)


EXCEPTION_TRIAGE_V1 = DecisionBundle(
    name="exception_triage",
    version="v1",
    policy_metadata={"risk": "high", "purpose": "ops_triage_only"},
    questions=(
        DecisionQuestion(
            "exception_category",
            "choice",
            (
                "Choose a likely routing category only. "
                "Never decide truth or turn a claim into fact."
            ),
            {
                "PAYMENT_DISPUTE": "A payment concern or allegation.",
                "ATTENDANCE_DISPUTE": "A concern or disagreement about attendance.",
                "COMPLETION_DISPUTE": "A concern or disagreement about completion.",
                "NO_SHOW_CONCERN": "A reported possible no-show.",
                "CANCELLED_AFTER_COMMITMENT": "Cancellation after accepted commitment.",
                "CANCELLED_AFTER_TRAVEL": (
                    "Cancellation after possible travel authorisation."
                ),
                "AMBIGUOUS_COMPLETION": "Completion information is unclear.",
                "VERIFICATION_TRUST_CONCERN": "A verification concern needing Ops.",
                "OTHER": "None of the above.",
            },
        ),
        DecisionQuestion(
            "needs_immediate_ops_attention",
            "noul",
            "Should this concern be visible to Ops promptly?",
            {
                "true": "Prompt Ops attention is appropriate.",
                "false": "Normal follow-up is appropriate.",
            },
        ),
    ),
)


CLOSEOUT_EVIDENCE_V1 = DecisionBundle(
    name="closeout_evidence",
    version="v1",
    policy_metadata={"risk": "high", "purpose": "draft_evidence_only"},
    questions=(
        DecisionQuestion(
            "work_completed_present",
            "noul",
            (
                "Does the text assert that work was completed? "
                "This is draft evidence only."
            ),
            {
                "true": "A completion assertion is present.",
                "false": "No completion assertion is present.",
            },
        ),
        DecisionQuestion(
            "partial_completion_present",
            "noul",
            (
                "Does the text assert incomplete work, an early departure, "
                "or partial completion?"
            ),
            {
                "true": "A partial-completion assertion is present.",
                "false": "No partial-completion assertion is present.",
            },
        ),
        DecisionQuestion(
            "attendance_assertion_present",
            "noul",
            "Does the text assert attendance, absence, or who came?",
            {
                "true": "An attendance assertion is present.",
                "false": "No attendance assertion is present.",
            },
        ),
        DecisionQuestion(
            "payment_assertion_present",
            "noul",
            "Does the text assert a payment fact or concern?",
            {
                "true": "A payment assertion is present.",
                "false": "No payment assertion is present.",
            },
        ),
        DecisionQuestion(
            "reuse_preference_present",
            "noul",
            "Does the text express a preference to reuse or avoid a worker?",
            {
                "true": "A reuse-preference assertion is present.",
                "false": "No reuse-preference assertion is present.",
            },
        ),
        DecisionQuestion(
            "possible_multi_worker_message",
            "noul",
            "Does the text appear to discuss more than one worker?",
            {
                "true": "The text may concern multiple workers.",
                "false": "The text appears to concern one worker or nobody.",
            },
        ),
        DecisionQuestion(
            "needs_operator_review",
            "noul",
            "Does this closeout text need review before a draft?",
            {
                "true": "Operator review is needed.",
                "false": "It can remain ordinary draft evidence.",
            },
        ),
    ),
)


def bundle_for_message_class(message_class: str) -> DecisionBundle:
    if message_class in {"EXCEPTION", "PAYMENT"}:
        return EXCEPTION_TRIAGE_V1
    if message_class == "CLOSEOUT":
        return CLOSEOUT_EVIDENCE_V1
    return MESSAGE_ROUTING_V1

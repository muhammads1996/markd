# FLO-133 semantic decision layer

Jev is a server-only, provider-neutral semantic-decision adapter in FastAPI.
It is never a backend, agent, domain service, source of truth, or command
executor.

## Safe flow

```text
persisted ChannelEvent -> durable worker -> transcription when applicable
-> semantic decision evidence -> existing policy / ProposedAction -> command validation
```

The Meta webhook does not call Jev. Voice media is transcribed first; Jev gets
only compact text state (`message`, channel, unresolved actor role, detected
language, and transcript confidence), never raw audio, a full chat history,
identity documents, profiles, or private Ops notes.

`semantic_decisions` is provider-neutral evidence linked to `channel_events`
and, when a draft exists, its `ProposedAction`.
It contains a state hash rather than duplicate message text, bundle/version,
provider/model, typed answers/probabilities, duration, failure metadata, and
the policy outcome. It cannot write a Workmark, payment state, no-show fact,
travel readiness, or exception resolution.

## Configuration

All variables are server-only and documented in `.env.example`:

```ini
TYPESAFE_API_KEY=...
SEMANTIC_DECISION_ENABLED=true
SEMANTIC_DECISION_MODE=shadow
SEMANTIC_DECISION_MODEL=jev-1.13.0
SEMANTIC_DECISION_TIMEOUT_SECONDS=8
SEMANTIC_DECISION_MAX_RETRIES=1
SEMANTIC_DECISION_ACTIVE_POLICY={}
```

Production starts `off` (the default) or `shadow`; it must not broadly start
`active`. Shadow writes evidence only and preserves the prior processing path.
For active low-risk routing, add an explicitly calibrated language/use-case
threshold such as `{"message_routing:AVAILABILITY:en": 0.95}`. There is no global
confidence threshold. An absent entry routes to confirmation/Ops rather than
automation. High-risk exception and closeout bundles remain Ops/draft only.

To disable Jev completely, set `SEMANTIC_DECISION_ENABLED=false` or
`SEMANTIC_DECISION_MODE=off`; existing message processing continues.

Timeouts, rate limits, transport failures, and malformed answers are stored as
failed evidence and safely fall back to deterministic parsing, the current
provider where policy permits, or the existing Ops-visible ChannelEvent path.
No provider failure can block the webhook acknowledgement or partially execute
a domain command.

## Bundles and evaluation

Versioned code-reviewed bundles are `message_routing@v1`,
`exception_triage@v1`, and `closeout_evidence@v1`. They classify bounded
semantic questions only. Dates, money, counts, rates, identity, permissions,
deduplication, state transitions, and travel readiness stay in deterministic
code.

Run the read-only synthetic benchmark:

```powershell
corepack pnpm api:test:semantic-eval -- --json
```

The 26 sanitized fixtures include English, Afrikaans, isiXhosa, code-switched
messages, short/noisy phrasing, and voice-note transcripts. It compares direct
Jev text, curated operator-reviewed normalised decision text while source values
remain intact,
and the existing heuristic/provider baseline. The report is grouped by
language and message class and separately counts unsafe false positives,
confirmation/Ops routing, expected-answer confidence, and applicable
exception/closeout follow-up bundle results.

There is no production `TranslationProvider` yet. The normalised arm is an
explicit reproducible comparison fixture, not an automated translation claim:
it measures whether English decision text would improve Jev routing while the
original ChannelEvent and deterministic values remain authoritative. Translation
latency, translation failure, and operator disagreement must be evaluated
before any translation-backed active policy is introduced.

### Initial live calibration (21 Sep 2026)

The live `jev-1.13.0` benchmark completed without provider failures; most
group median call latencies were roughly 350 to 1,310 ms. Direct evaluation
produced unsafe clear-route false positives in English and isiXhosa exception
cases. Normalised decision text reduced some observed unsafe errors but did not
make every class correct; it also changed results inconsistently for Afrikaans,
isiXhosa, and code-switched assignment responses. The current OpenRouter
structured-intent baseline varied by language/message class as well.

Therefore no active policy entry is committed. Keep all language/use-case
classes in shadow/Ops until a larger operator-labelled field set establishes
class-specific thresholds and review outcomes.

# Product Design System & Mobile UX v1 — MARKD

# MARKD Product Design System & Mobile UX v1

## 1. Purpose

This document defines the product design direction for MARKD's participant-facing **mobile-first PWA experience** and the shared UX rules that must also be reflected through WhatsApp.

The participant PWA is an **optional premium interface over the same Work Graph**, not a prerequisite for participating in MARKD. It must be fully usable in a normal mobile browser and may be installed to the home screen where supported.

A worker or contractor who never installs the app must still be able to complete the essential MARKD journey through WhatsApp, voice notes, calls and operator assistance.

The design reference is the September 2026 clickable mobile concept using the MARKD **Obsidian + Signal Lime** brand direction and the product principle **“Work leaves a mark.”**

---

## 2. Product-design thesis

MARKD should feel like a **trust-and-work utility first and a marketplace second**.

The UI must make three ideas almost physical:

1. **I have work secured.**
2. **This is my portable work identity.**
3. **This work happened and now strengthens my record.**

The app should feel premium, credible and dignified. Accessibility must simplify interaction without making the experience childish or patronising.

### Non-negotiable UX rules

- **Confirmation is sacred.** `WORK CONFIRMED` is the only worker-facing state that authorises travel.
- **Offer ≠ job.** Accepting an offer does not mean the worker should travel.
- **Evidence over ratings.** Workmarks, repeat relationships and contextual attendance evidence outrank opaque scores.
- **One graph, many interfaces.** App, WhatsApp and Ops must display and mutate the same canonical state.
- **No app lock-in.** No critical worker action may exist only in the app.
- **Low-literacy friendly.** Short copy, large touch targets, audio playback, familiar places and simple choices are first-class design requirements.
- **Relationship-first fulfilment.** Contractors see known/repeat workers before unknown supply.

---

## 3. Visual direction

### Brand character

Industrial editorial rather than generic gig-economy UI.

The interface should feel:

- sturdy
- modern
- human
- high contrast
- professional
- built for real work

Avoid visual tropes that make MARKD look like a fintech wallet, delivery app, HR portal or public job board.

### Core palette

| Token          | Value     | Use                                              |
| -------------- | --------- | ------------------------------------------------ |
| Obsidian / Ink | `#111315` | primary dark surfaces, premium cards, app chrome |
| Ink 2          | `#171A1D` | elevated dark surfaces                           |
| Ink 3          | `#202428` | secondary dark surfaces                          |
| Signal Lime    | `#C7F43D` | confirmed / verified / primary action / progress |
| Lime Soft      | `#E8FF9F` | low-emphasis positive chips                      |
| Concrete       | `#F2F1EC` | light background                                 |
| Steel          | `#687078` | secondary text / structure                       |
| White          | `#FFFFFF` | cards / high contrast text                       |
| Danger         | `#FF685F` | destructive or failure state only                |

Signal Lime should be intentionally scarce. It is reserved mainly for **confirmed, verified, actionable or successfully completed** states so that the colour itself develops product meaning.

### Typography

Use **Sora** as the preferred display/UI family, with a robust system fallback. Typography should favour heavy, compact headings and very clear numeric information.

- large state headings
- strong numeric hierarchy for pay, time and counts
- short labels in uppercase where useful
- avoid dense paragraphs inside operational flows

### Shape and density

- rounded but sturdy surfaces, generally 12–28 px radius depending on component size
- dense factual cards rather than decorative whitespace
- high-contrast primary buttons
- minimal gradients
- subtle technical/grid motifs are acceptable
- motion should communicate state change rather than decorate

---

## 4. Shared interaction architecture

The external product has three primary participation surfaces:

1. **Worker PWA** — optional authenticated, mobile-first companion experience.
2. **Contractor / Builder PWA mode** — optional self-service labour-book and fulfilment experience.
3. **WhatsApp** — first-class app-less interface for the same state and actions.

MARKD operators use the Ops PWA as the internal control plane.

### Cross-channel rule

A user action changes canonical domain state once. Interfaces subscribe to that state.

Example:

`worker accepts in app → Assignment state updates → Ops sees it → contractor sees it → WhatsApp mirror may confirm receipt`

and equally:

`worker replies YES on WhatsApp → Assignment state updates → app shows accepted/waiting state on next sync`

No channel owns a private version of assignment truth.

---

## 5. Worker PWA information architecture

Primary navigation:

### Home

Answers **“Do I have work today?”** before anything else.

If travel-ready work exists, the confirmed assignment dominates the screen.

Confirmed card must show at minimum:

- `WORK CONFIRMED`
- work type
- contractor
- date / start time
- agreed rate/terms where known
- area / reporting point
- distance or travel context where useful
- pickup/self-travel instruction
- `I'M ON MY WAY` / logistics acknowledgement action
- `LISTEN`
- `DIRECTIONS` when a pin/link is available

The next opportunity and Work Card summary can appear below the confirmed job.

### Work

Contains:

- current offers
- accepted/waiting assignments
- upcoming confirmed work
- recent completed work

Offer cards should be glanceable: work type, contractor, pay, date/time, area and travel context.

### My Card

Portable proof-of-work surface generated from the Work Graph.

### Profile

Contains only worker-relevant settings and preferences such as:

- preferred language
- audio/read-aloud preference
- availability
- familiar work areas / travel preference
- WhatsApp mirroring preference where configurable
- contact/account details

---

## 6. Worker assignment state machine

The mobile UI and WhatsApp copy must map to the same canonical states.

### 1. OFFER — DO NOT TRAVEL

Worker sees essential job facts and one primary decision:

- `TAKE JOB`
- `CAN'T GO`
- `LISTEN`
- call/voice-note fallback through WhatsApp

The UI must explicitly say that accepting does **not** authorise travel.

### 2. ACCEPTED — WAITING FOR CONFIRMATION

After the worker accepts:

- show accepted state immediately
- disable duplicate acceptance
- show **DO NOT TRAVEL YET** prominently
- reflect the same state in WhatsApp if mirroring is active

### 3. WORK CONFIRMED — TRAVEL READY

This is a major visual state transition.

Signal Lime is the primary status colour. The worker receives final logistics and may now travel.

### 4. ON MY WAY / LOGISTICS ACKNOWLEDGED

Optional acknowledgement useful to contractor and Ops. This must not become surveillance or live tracking.

### 5. ARRIVED / STARTED

Capture only when operationally useful. Do not force extra worker taps for the sake of analytics.

### 6. COMPLETED → STAMP

After work, collect the minimum bilateral completion evidence needed to close the Assignment into a Workmark.

The Stamp interaction should feel satisfying and recognisable without turning work history into a game.

---

## 7. Contractor / Builder PWA information architecture

The contractor experience solves certainty and reuse before discovery.

Primary navigation:

### Home

A next-day crew dashboard:

- site/date/start time
- total confirmed vs required
- counts per work type
- open positions
- urgent gaps
- direct action to fill missing positions
- trusted workers recently used

### Hire

Find workers for a specific requirement.

Default ranking principles:

1. worked with this contractor before
2. repeat relationship evidence
3. relevant demonstrated skill
4. availability
5. travel practicality / proximity
6. broader graph evidence

Avoid presenting an opaque “AI best fit” score.

### Workers

The contractor's reusable labour book.

Show:

- workers used before
- number of jobs/Workmarks together
- most recent work
- demonstrated work types
- contextual attendance evidence where statistically meaningful
- `HIRE AGAIN` / `REHIRE`

### Jobs

Active/upcoming Labour Requests and staffing status.

---

## 8. Work Card design

The Work Card should use the information density and recognisability of a sports/player card without assigning human worth a global rating.

### Front-face information

- portrait
- display name
- main demonstrated work categories
- broad area
- safe verification markers
- confirmed Workmark count
- completed job count where semantically distinct
- repeat contractor count
- number of contractor relationships
- recent work
- attendance/show-up evidence only after the minimum denominator and policy threshold is met

### Evidence layers

The detailed card may expose:

- chronological Workmarks
- demonstrated skills and evidence counts
- repeat contractors
- recent activity
- verification provenance
- crews / frequent working relationships where appropriate

### Sharing

Support:

- revocable share link
- QR code
- share to WhatsApp

Private phone numbers, identity documents, home addresses, private notes and unresolved allegations are excluded by default.

---

## 9. WhatsApp mirroring and app-less parity

WhatsApp is not merely a notification channel.

### Essential worker flows that must work without the app

- enrol / update basic details
- communicate availability
- receive a work offer
- accept / decline / request a call
- receive `DO NOT TRAVEL YET` acknowledgement
- receive `WORK CONFIRMED` travel-ready instructions
- receive pickup/reporting details and location pin where useful
- acknowledge logistics / say on the way where needed
- report cancellation/problem
- confirm completion/payment outcome
- provide a voice note instead of typing
- receive/share a Work Card link when available

### Essential contractor flows that must work without the app

- request labour
- confirm requirements
- receive candidate/known-worker options where appropriate
- confirm selected workers
- receive crew status
- handle cancellation/replacement
- close out completed work / Stamp outcomes

### Mirroring behaviour

Critical assignment-state changes should be mirrored into WhatsApp unless the user has explicitly chosen a supported alternative and policy allows it.

Push notifications may supplement WhatsApp for app users, but WhatsApp remains the fallback channel for critical state changes during the pilot.

When both channels are used, copy and status semantics must be identical enough that there is no ambiguity about whether the worker should travel.

---

## 10. Accessibility and language

Initial worker languages:

- English
- Afrikaans
- isiXhosa

The app must remain extensible beyond these languages.

### Low-literacy interaction rules

- one decision per screen/message where practical
- minimum 44×44 px touch targets; prefer larger for primary actions
- icon + text, not icon-only for consequential actions
- put pay/date/time/location into discrete visual fields
- provide `LISTEN` on work offers and confirmed jobs
- never hide critical travel state in supporting copy
- avoid jargon such as “assignment lifecycle” in worker-facing text
- allow voice-note/call fallback from WhatsApp
- use familiar areas, taxi ranks, labour stands and landmarks rather than requiring exact addresses or kilometre-radius configuration

### Sunlight and field conditions

Use high contrast, bold text and strong state separation. Avoid light grey-on-white information and subtle colour-only distinctions.

---

## 11. Core components

The initial shared component system should include:

- MARKD app bar / wordmark treatment
- state/status pill
- confirmed-job hero card
- work-offer card
- metric cell
- primary / secondary / dark-ghost buttons
- bottom navigation
- bottom sheet
- worker mini-card
- Work Card
- verification badge
- factual chip
- staffing progress row
- filter chips
- language/audio settings row
- confirmation / Stamp animation
- toast / transient feedback
- empty and degraded-connectivity states

Components should use shared design tokens across Ops, public and participant PWA surfaces, preserving framework-neutral tokens so a future native client could reuse them if ever justified.

---

## 12. Content design

Prefer direct worker language:

- `WORK OFFER`
- `DO NOT TRAVEL YET`
- `TAKE JOB`
- `WORK CONFIRMED`
- `I'M ON MY WAY`
- `CAN'T GO`
- `LISTEN`

Avoid weak or ambiguous labels such as:

- Pending
- Processing
- Reserved
- Accepted (without travel guidance)
- Active

Contractor copy can be denser but should still prioritise crew gaps and next actions.

---

## 13. PWA implementation guidance

Preferred technical direction is a **single shared Next.js + React + TypeScript product stack**:

- Ops, public/shareable and participant surfaces live in `/apps/web`
- participant experiences are mobile-first route groups/layouts with distinct authentication and authorisation boundaries from Ops
- the participant surface is installable as a PWA but remains fully usable in the browser
- shared domain contracts, state-machine semantics, i18n message keys and design tokens remain in workspace packages

Do not create `/apps/mobile`, Expo or React Native for the current phase.

The PWA should consume policy-controlled read models and execute the same application commands used by WhatsApp/Ops. Critical Assignment transitions must be validated against canonical server state; do not invent an offline mutation state machine.

Native mobile remains a deferred option only if real field evidence shows that PWA limitations materially block essential capabilities.

---

## 14. Cross-channel analytics

Measure behaviour rather than vanity app metrics.

Useful events:

- offer delivered by channel
- offer listened to
- offer accepted / declined / call requested
- time from offer to response
- confirmation delivered
- confirmation acknowledged
- channel used for response
- WhatsApp-to-app and app-to-WhatsApp continuation
- on-my-way acknowledgement
- late cancellation after travel authorisation
- Work Card viewed/shared
- repeat hire initiated

Do not optimise for app installs if workers are successfully completing work through WhatsApp.

---

## 15. Acceptance bar for participant-facing design

A flow is not complete until:

1. The participant PWA version is clear, accessible and usable without installation.
2. The equivalent essential journey works without the app through WhatsApp/operator support.
3. Both paths resolve to the same canonical domain state.
4. Travel authorisation cannot be inferred from offer acceptance.
5. High-trust Workmark writes preserve provenance.
6. Critical text has approved language templates and audio/call fallback where required.
7. No private data is leaked through Work Card or contractor views.
8. The interface uses the MARKD Obsidian + Signal Lime design system consistently.

---

## 16. Initial implementation slices

### Slice A — shared design system + participant PWA shell

Implement mobile-first navigation, tokens, components, installable PWA metadata and read-only fixture screens matching the approved concept inside the existing Next.js web application.

### Slice B — worker fulfilment flow

Wire Home and Work to real Assignment state: offer → accepted/waiting → confirmed/travel-ready → acknowledgement.

### Slice C — WhatsApp parity

Ensure the same transitions can originate from WhatsApp and immediately project into the participant PWA/Ops surfaces.

### Slice D — Work Card

Use real Workmark projections and sharing policy.

### Slice E — contractor labour book

Wire contractor Home / Hire / Workers / Jobs to real LabourRequest, Assignment and relationship data.

The visual concept is a design direction, not permission to hard-code demo statistics or bypass canonical domain rules.

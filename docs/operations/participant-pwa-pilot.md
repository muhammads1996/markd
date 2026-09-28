# Participant PWA access during the controlled pilot

Participant PWA access is optional. Workers and contractors can continue using
WhatsApp, calls, or operator support without creating an account. Do not treat
PWA activation as a condition of participating in MARKD.

## Provision access from an existing record

1. Confirm the participant wants PWA access and that the existing Worker
   Profile or Organisation Contact has the correct primary phone number.
2. As an authenticated MARKD operator, provision from that existing record:
   `POST /api/v1/participant-access/provision` with
   `{"scope_kind":"worker","subject_id":"<worker-person-uuid>"}` or
   `{"scope_kind":"contractor","subject_id":"<organisation-contact-uuid>"}`.
   The endpoint is operator-authenticated. It does not create a Person or
   Organisation Contact. Repeating the same request is safe and returns the
   existing pending or active account state.
3. Give the participant the PWA address and ask them to open
   `/participant/sign-in` using the phone number already registered on their
   MARKD record. Do not send or record an OTP on their behalf.
4. The participant enters the one-time SMS code and lands in their authorized
   worker or contractor view. An account may have both views only when both
   canonical relationships have been provisioned.

If the phone number is missing or wrong, correct it on the existing identity
record through the normal operator workflow before first provisioning. Do not
create a second Person or contact as a shortcut. Changing a provisioned
person's primary number disables PWA access. Rebinding a disabled account to
a new number remains part of FLO-136; keep that PWA access disabled and use
WhatsApp or operator support until the controlled recovery path is verified.

## Configure production SMS

Production participant sign-in uses Supabase Auth phone OTP. Configure the
project's approved SMS provider and sender in Supabase Auth, including delivery
limits, country policy, sender identity, and monitoring. Keep phone sign-up
disabled: operators provision Auth users from existing MARKD identities, and
the sign-in page must not create accounts. Test delivery and recovery with
controlled recipients before inviting pilot participants. Keep provider
credentials in Supabase's secret configuration, never in this repository,
browser variables, logs, screenshots, or Linear.

Local E2E may use only the synthetic fixed test numbers and code in
`supabase/config.toml` under `[auth.sms.test_otp]`; these are local test values,
not real recipient numbers or production credentials. Keep phone sign-up
disabled locally as well. Do not copy the test OTP configuration into hosted
Supabase projects.

## Sign-in, recovery, and revocation

Participants can request another OTP from the sign-in page. If SMS does not
arrive, they should check the registered phone with an operator and request a
new code. A changed primary phone needs the controlled recovery path before
PWA access can resume.
Never ask for the participant's password because this flow uses OTP.

To revoke PWA access while retaining the participant's Work Graph identity and
WhatsApp participation, an authenticated operator calls
`POST /api/v1/participant-access/{person_id}/disable`. The account's disabled
state blocks participant routes. Revocation does not archive the Worker
Profile, Organisation Contact, Person, or WhatsApp identity and does not stop
WhatsApp communication.

## Pilot checks

Use local synthetic records and the fixed local OTP to verify both paths:

- provision an existing Worker Profile, request and verify an OTP, reach the
  worker view, and confirm a worker cannot open contractor-only routes;
- provision an existing Organisation Contact, request and verify an OTP, and
  reach the contractor view;
- confirm participant sessions do not open operator routes and an operator
  session does not grant participant scopes;
- repeat provisioning and confirm it does not create another Person or contact;
- disable an account and confirm participant access is denied while the
  canonical identity remains available to WhatsApp workflows.

Record test outcomes without phone numbers, OTPs, Auth tokens, provider
secrets, or participant PII. Keep the PWA private until these checks and the
approved production SMS configuration are ready for the controlled pilot.

import { describe, expect, it } from "vitest";

import {
  isActiveParticipantAccount,
  isParticipantActivationGranted,
  isValidParticipantPhone,
} from "../../apps/web/src/app/participant/sign-in/validation";

describe("participant sign-in admission checks", () => {
  it("accepts only E.164 phone numbers for OTP requests", () => {
    expect(isValidParticipantPhone("+27821234567")).toBe(true);
    expect(isValidParticipantPhone("0821234567")).toBe(false);
    expect(isValidParticipantPhone("+0123456789")).toBe(false);
    expect(isValidParticipantPhone("+1234567")).toBe(false);
  });

  it("requires the activation RPC to explicitly grant access", () => {
    expect(isParticipantActivationGranted(true)).toBe(true);
    expect(isParticipantActivationGranted(false)).toBe(false);
    expect(isParticipantActivationGranted(null)).toBe(false);
    expect(isParticipantActivationGranted({ status: "active" })).toBe(false);
  });

  it("requires an active account owned by the verified auth user", () => {
    const authUserId = "90000000-0000-4000-8000-000000000136";
    expect(
      isActiveParticipantAccount(authUserId, {
        auth_user_id: authUserId,
        status: "active",
      }),
    ).toBe(true);
    expect(
      isActiveParticipantAccount(authUserId, {
        auth_user_id: "another-user",
        status: "active",
      }),
    ).toBe(false);
    expect(
      isActiveParticipantAccount(authUserId, {
        auth_user_id: authUserId,
        status: "disabled",
      }),
    ).toBe(false);
    expect(isActiveParticipantAccount(authUserId, null)).toBe(false);
  });
});

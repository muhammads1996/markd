import { describe, expect, it } from "vitest";

import {
  findParticipantScope,
  validateParticipantSession,
} from "../../apps/web/src/lib/participant/auth";

const authUserId = "90000000-0000-4000-8000-000000000126";
const personId = "10000000-0000-4000-8000-000000000126";
const contactId = "30000000-0000-4000-8000-000000000126";

describe("participant auth validation", () => {
  it("rejects a missing or disabled participant account", () => {
    expect(validateParticipantSession(authUserId, null, [])).toEqual({
      ok: false,
      reason: "missing_account",
    });
    expect(
      validateParticipantSession(
        authUserId,
        { auth_user_id: authUserId, person_id: personId, status: "disabled" },
        [],
      ),
    ).toEqual({ ok: false, reason: "disabled_account" });
  });

  it("maps only valid owned scopes into the canonical session shape", () => {
    const result = validateParticipantSession(
      authUserId,
      { auth_user_id: authUserId, person_id: personId, status: "active" },
      [
        {
          auth_user_id: authUserId,
          scope_kind: "worker",
          organisation_contact_id: null,
        },
        {
          auth_user_id: authUserId,
          scope_kind: "contractor",
          organisation_contact_id: contactId,
        },
        {
          auth_user_id: "another-user",
          scope_kind: "worker",
          organisation_contact_id: null,
        },
      ],
    );

    expect(result).toEqual({
      ok: true,
      session: {
        authUserId,
        personId,
        scopes: [
          { kind: "worker" },
          { kind: "contractor", organisationContactId: contactId },
        ],
      },
    });
  });

  it("rejects malformed account and scope rows", () => {
    expect(
      validateParticipantSession(
        authUserId,
        { auth_user_id: "another-user", person_id: personId, status: "active" },
        [],
      ),
    ).toEqual({ ok: false, reason: "invalid_account" });
    expect(
      validateParticipantSession(
        authUserId,
        { auth_user_id: authUserId, person_id: personId, status: "active" },
        [
          {
            auth_user_id: authUserId,
            scope_kind: "contractor",
            organisation_contact_id: null,
          },
        ],
      ),
    ).toEqual({ ok: false, reason: "invalid_scope" });
  });

  it("returns no scope when the requested kind is not granted", () => {
    expect(findParticipantScope([{ kind: "worker" }], "contractor")).toBeNull();
  });
});

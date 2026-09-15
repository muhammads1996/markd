import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../supabase/server";

export type ParticipantScope =
  { kind: "worker" } | { kind: "contractor"; organisationContactId: string };

export interface ParticipantSession {
  authUserId: string;
  personId: string;
  scopes: ParticipantScope[];
}

export type ParticipantSessionValidation =
  | { ok: true; session: ParticipantSession }
  | {
      ok: false;
      reason:
        | "missing_account"
        | "disabled_account"
        | "invalid_account"
        | "invalid_scope";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateParticipantSession(
  authUserId: string,
  accountRow: unknown,
  scopeRows: unknown,
): ParticipantSessionValidation {
  if (accountRow === null || accountRow === undefined) {
    return { ok: false, reason: "missing_account" };
  }
  if (!isRecord(accountRow)) return { ok: false, reason: "invalid_account" };
  if (accountRow.status === "disabled") {
    return { ok: false, reason: "disabled_account" };
  }
  if (
    accountRow.status !== "active" ||
    accountRow.auth_user_id !== authUserId ||
    typeof accountRow.person_id !== "string"
  ) {
    return { ok: false, reason: "invalid_account" };
  }
  if (!Array.isArray(scopeRows)) return { ok: false, reason: "invalid_scope" };

  const scopes: ParticipantScope[] = [];
  for (const scopeRow of scopeRows) {
    if (!isRecord(scopeRow) || scopeRow.auth_user_id !== authUserId) continue;
    if (
      scopeRow.scope_kind === "worker" &&
      scopeRow.organisation_contact_id === null
    ) {
      scopes.push({ kind: "worker" });
      continue;
    }
    if (
      scopeRow.scope_kind === "contractor" &&
      typeof scopeRow.organisation_contact_id === "string"
    ) {
      scopes.push({
        kind: "contractor",
        organisationContactId: scopeRow.organisation_contact_id,
      });
      continue;
    }
    return { ok: false, reason: "invalid_scope" };
  }

  return {
    ok: true,
    session: { authUserId, personId: accountRow.person_id, scopes },
  };
}

export function findParticipantScope(
  scopes: readonly ParticipantScope[],
  kind: ParticipantScope["kind"],
): ParticipantScope | null {
  return scopes.find((scope) => scope.kind === kind) ?? null;
}

export async function requireParticipantSession(): Promise<ParticipantSession> {
  let authUserId: string | undefined;
  let accountRow: unknown;
  let scopeRows: unknown;

  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    authUserId = userData.user?.id;
    if (!authUserId) redirect("/sign-in?returnTo=/participant");

    const [accountResult, scopesResult] = await Promise.all([
      supabase
        .from("participant_accounts")
        .select("auth_user_id, person_id, status")
        .eq("auth_user_id", authUserId)
        .maybeSingle(),
      supabase
        .from("participant_account_scopes")
        .select("auth_user_id, scope_kind, organisation_contact_id")
        .eq("auth_user_id", authUserId),
    ]);
    if (accountResult.error) throw accountResult.error;
    if (scopesResult.error) throw scopesResult.error;
    accountRow = accountResult.data;
    scopeRows = scopesResult.data;
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/sign-in?reason=configuration&returnTo=/participant");
  }

  const validation = validateParticipantSession(
    authUserId,
    accountRow,
    scopeRows,
  );
  if (!validation.ok) {
    redirect(`/sign-in?reason=not-authorised&returnTo=/participant`);
  }
  return validation.session;
}

export async function requireParticipantScope(
  kind: ParticipantScope["kind"],
): Promise<ParticipantSession & { activeScope: ParticipantScope }> {
  const session = await requireParticipantSession();
  const activeScope = findParticipantScope(session.scopes, kind);
  if (!activeScope) redirect("/participant?reason=scope");
  return { ...session, activeScope };
}

"use server";

import { createServerClient } from "@supabase/ssr";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import {
  isActiveParticipantAccount,
  isParticipantActivationGranted,
  isValidParticipantPhone,
} from "./validation";

export type ParticipantSignInState = {
  error: string | null;
  phone: string;
  stage: "phone" | "code";
  notice: string | null;
};

const initialState: ParticipantSignInState = {
  error: null,
  phone: "",
  stage: "phone",
  notice: null,
};

async function createActionSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;

  const cookieStore = await cookies();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options),
        );
      },
    },
  });
}

export async function requestParticipantCodeAction(
  _previousState: ParticipantSignInState = initialState,
  formData: FormData,
): Promise<ParticipantSignInState> {
  const phone = String(formData.get("phone") ?? "").trim();
  if (!isValidParticipantPhone(phone)) {
    return {
      error: "Enter your phone number with country code, for example +27…",
      phone,
      stage: "phone",
      notice: null,
    };
  }

  const supabase = await createActionSupabaseClient();
  if (!supabase) {
    return {
      error: "Participant sign-in is temporarily unavailable. Try again later.",
      phone,
      stage: "phone",
      notice: null,
    };
  }

  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { shouldCreateUser: false },
  });
  if (error) {
    // Do not reveal whether this phone has a participant account.
    return {
      error: null,
      phone,
      stage: "code",
      notice:
        "If participant access is available for this number, a sign-in code has been sent.",
    };
  }

  return {
    error: null,
    phone,
    stage: "code",
    notice:
      "If participant access is available for this number, a sign-in code has been sent.",
  };
}

export async function verifyParticipantCodeAction(
  _previousState: ParticipantSignInState = initialState,
  formData: FormData,
): Promise<ParticipantSignInState> {
  const phone = String(formData.get("phone") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  if (!isValidParticipantPhone(phone) || !/^\d{4,10}$/.test(token)) {
    return {
      error: "Enter the phone number and code sent to you.",
      phone,
      stage: "code",
      notice: null,
    };
  }

  const supabase = await createActionSupabaseClient();
  if (!supabase) {
    return {
      error: "Participant sign-in is temporarily unavailable. Try again later.",
      phone,
      stage: "code",
      notice: null,
    };
  }

  const { error: verifyError } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: "sms",
  });
  if (verifyError) {
    return {
      error: "That code could not be verified. Check it and try again.",
      phone,
      stage: "code",
      notice: null,
    };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    await supabase.auth.signOut();
    return denied(phone);
  }

  const { data: activated, error: activationError } = await supabase.rpc(
    "activate_participant_account",
  );
  if (activationError || !isParticipantActivationGranted(activated)) {
    await supabase.auth.signOut();
    return denied(phone);
  }

  const { data: account, error: accountError } = await supabase
    .from("participant_accounts")
    .select("auth_user_id, status")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (accountError || !isActiveParticipantAccount(userData.user.id, account)) {
    await supabase.auth.signOut();
    return denied(phone);
  }

  redirect("/participant");
}

function denied(phone: string): ParticipantSignInState {
  return {
    error:
      "We could not activate participant access for this number. Contact MARKD Ops for help.",
    phone,
    stage: "code",
    notice: null,
  };
}

export async function participantSignOutAction(): Promise<void> {
  const supabase = await createActionSupabaseClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/participant/sign-in");
}

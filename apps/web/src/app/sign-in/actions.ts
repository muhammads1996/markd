"use server";

import { createServerClient } from "@supabase/ssr";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export type SignInState = {
  error: string | null;
};

export async function signInAction(
  _previousState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return { error: "Operator sign-in is not configured on this device." };
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      // Setting cookies on the request here lets the redirect below carry
      // the session in the same response, avoiding a client-side race
      // between signInWithPassword's cookie sync and a client navigation.
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options),
        );
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return {
      error: "We could not sign you in. Check your operator credentials.",
    };
  }

  redirect("/operator");
}

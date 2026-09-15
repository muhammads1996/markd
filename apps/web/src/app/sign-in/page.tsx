"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";

export default function SignInPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const data = new FormData(event.currentTarget);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: String(data.get("email") ?? ""),
        password: String(data.get("password") ?? ""),
      });
      if (signInError) {
        setError("We could not sign you in. Check your operator credentials.");
        return;
      }
      window.location.replace("/operator");
    } catch {
      setError("Operator sign-in is not configured on this device.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="shell auth-shell">
      <section className="intro" aria-labelledby="sign-in-title">
        <p className="eyebrow">MARKD operator access</p>
        <h1 id="sign-in-title">Sign in</h1>
        <p className="lede">
          Use the account provisioned for your operator role.
        </p>
        <form className="auth-form" onSubmit={signIn}>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error ? (
            <p role="alert" className="auth-error">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

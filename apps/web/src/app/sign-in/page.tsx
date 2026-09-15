"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signInAction, type SignInState } from "./actions";

const initialState: SignInState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export default function SignInPage() {
  const [state, formAction] = useActionState(signInAction, initialState);

  return (
    <main className="shell auth-shell">
      <section className="intro" aria-labelledby="sign-in-title">
        <p className="eyebrow">MARKD operator access</p>
        <h1 id="sign-in-title">Sign in</h1>
        <p className="lede">
          Use the account provisioned for your operator role.
        </p>
        <form className="auth-form" action={formAction}>
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
          {state.error ? (
            <p role="alert" className="auth-error">
              {state.error}
            </p>
          ) : null}
          <SubmitButton />
        </form>
      </section>
    </main>
  );
}

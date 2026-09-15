"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";

import { signInAction, type SignInState } from "./actions";
import styles from "./sign-in.module.css";

const initialState: SignInState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className={styles.submitButton}
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      <span>{pending ? "Signing in..." : "Sign in"}</span>
      <span className={styles.buttonArrow} aria-hidden="true">
        →
      </span>
    </button>
  );
}

export default function SignInPage() {
  const [state, formAction] = useActionState(signInAction, initialState);

  return (
    <main className={styles.page}>
      <section className={styles.brandPanel} aria-label="MARKD">
        <Link className={styles.wordmark} href="/">
          MARKD<span aria-hidden="true">.</span>
        </Link>
        <div className={styles.brandMessage}>
          <p className={styles.brandKicker}>Operator workspace</p>
          <p className={styles.brandStatement}>Real work leaves a mark.</p>
        </div>
        <p className={styles.brandFoot}>Cape Town · Field operations</p>
      </section>

      <section className={styles.accessPanel} aria-labelledby="sign-in-title">
        <div className={styles.formFrame}>
          <div className={styles.headingGroup}>
            <p className={styles.eyebrow}>
              <span aria-hidden="true" /> Secure operator access
            </p>
            <h1 id="sign-in-title">Sign in</h1>
            <p className={styles.lede}>
              Enter the account assigned to your operator role.
            </p>
          </div>

          <form className={styles.form} action={formAction}>
            <label className={styles.field}>
              <span>Email</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="name@company.co.za"
                required
              />
            </label>
            <label className={styles.field}>
              <span>Password</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                required
              />
            </label>
            {state.error ? (
              <p role="alert" className={styles.error}>
                <span aria-hidden="true">!</span>
                {state.error}
              </p>
            ) : null}
            <SubmitButton />
          </form>

          <div className={styles.accessNote}>
            <span className={styles.accessMark} aria-hidden="true">
              ✓
            </span>
            <p>
              Operator access is provisioned by a MARKD administrator.
              Participant access remains separate.
            </p>
          </div>
        </div>
        <p className={styles.legal}>MARKD · Work Graph Pilot</p>
      </section>
    </main>
  );
}

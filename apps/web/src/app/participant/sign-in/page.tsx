"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";

import {
  participantSignOutAction,
  requestParticipantCodeAction,
  verifyParticipantCodeAction,
  type ParticipantSignInState,
} from "./actions";
import styles from "../../sign-in/sign-in.module.css";
import participantStyles from "./sign-in.module.css";

const initialState: ParticipantSignInState = {
  error: null,
  phone: "",
  stage: "phone",
  notice: null,
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className={styles.submitButton}
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      <span>{pending ? "Please wait…" : label}</span>
      <span className={styles.buttonArrow} aria-hidden="true">
        →
      </span>
    </button>
  );
}

export default function ParticipantSignInPage() {
  const [requestState, requestAction] = useActionState(
    requestParticipantCodeAction,
    initialState,
  );
  const [verifyState, verifyAction] = useActionState(
    verifyParticipantCodeAction,
    initialState,
  );
  const hasRequestedCode = requestState.stage === "code";
  const phone = hasRequestedCode ? requestState.phone : verifyState.phone;
  const error = verifyState.error ?? requestState.error;
  const notice = requestState.notice;

  return (
    <main className={styles.page}>
      <section className={styles.brandPanel} aria-label="MARKD">
        <Link className={styles.wordmark} href="/">
          MARKD<span aria-hidden="true">.</span>
        </Link>
        <div className={styles.brandMessage}>
          <p className={styles.brandKicker}>Participant access</p>
          <p className={styles.brandStatement}>Your work, connected.</p>
        </div>
        <p className={styles.brandFoot}>Worker and contractor access</p>
      </section>

      <section className={styles.accessPanel} aria-labelledby="sign-in-title">
        <div className={styles.formFrame}>
          <div className={styles.headingGroup}>
            <p className={styles.eyebrow}>
              <span aria-hidden="true" /> Secure participant access
            </p>
            <h1 id="sign-in-title">Sign in</h1>
            <p className={styles.lede}>
              {hasRequestedCode
                ? `Enter the code sent to ${phone}.`
                : "Use the phone number registered with MARKD. You do not need a password."}
            </p>
          </div>

          {hasRequestedCode ? (
            <>
              <form className={styles.form} action={verifyAction}>
                <input type="hidden" name="phone" value={phone} />
                <label className={styles.field}>
                  <span>Sign-in code</span>
                  <input
                    name="token"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{4,10}"
                    maxLength={10}
                    placeholder="Enter your code"
                    required
                  />
                </label>
                {error ? (
                  <p role="alert" className={styles.error}>
                    <span aria-hidden="true">!</span>
                    {error}
                  </p>
                ) : notice ? (
                  <p role="status" className={styles.accessNote}>
                    {notice}
                  </p>
                ) : null}
                <SubmitButton label="Verify code" />
              </form>

              <form className={styles.form} action={requestAction}>
                <input type="hidden" name="phone" value={phone} />
                <button
                  className={participantStyles.secondaryButton}
                  type="submit"
                >
                  Send another code
                </button>
              </form>
            </>
          ) : (
            <form className={styles.form} action={requestAction}>
              <label className={styles.field}>
                <span>Mobile phone number</span>
                <input
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+27…"
                  required
                />
              </label>
              {error ? (
                <p role="alert" className={styles.error}>
                  <span aria-hidden="true">!</span>
                  {error}
                </p>
              ) : null}
              <SubmitButton label="Send sign-in code" />
            </form>
          )}

          <div className={styles.accessNote}>
            <span className={styles.accessMark} aria-hidden="true">
              i
            </span>
            <p>
              Participant access is optional. You can continue using WhatsApp
              without a PWA account. Need help? Contact MARKD Ops.
            </p>
          </div>
          <p>
            <Link href="/sign-in">Operator sign-in</Link>
          </p>
        </div>

        <form action={participantSignOutAction}>
          <button className={participantStyles.secondaryButton} type="submit">
            Sign out of participant access
          </button>
        </form>
        <p className={styles.legal}>MARKD · Work Graph Pilot</p>
      </section>
    </main>
  );
}

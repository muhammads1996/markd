"use client";

import { useActionState } from "react";

import type { ExceptionQueueItem } from "../../../features/exceptions/queries";
import { addExceptionClaim, resolveException, type ExceptionActionState } from "./actions";
import styles from "./exceptions.module.css";

const initialState: ExceptionActionState = {};

function dateLabel(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(date);
}

function ageLabel(value: string): string {
  const opened = new Date(value);
  if (Number.isNaN(opened.getTime())) return "Unknown";
  const days = Math.max(0, Math.floor((Date.now() - opened.getTime()) / 86_400_000));
  return days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`;
}

function ActionMessage({ state }: { state: ExceptionActionState }) {
  if (state.error) return <p className={styles.error} role="alert">{state.error}</p>;
  if (state.saved) return <p className={styles.success} role="status">Saved.</p>;
  return null;
}

export function ExceptionCard({ item, claimNonce, resolveNonce }: { item: ExceptionQueueItem; claimNonce: string; resolveNonce: string }) {
  const [claimState, claimAction, claimPending] = useActionState(addExceptionClaim, initialState);
  const [resolveState, resolveAction, resolvePending] = useActionState(resolveException, initialState);
  const active = item.state !== "resolved";
  return (
    <article className={styles.card} aria-label={`${item.type} exception for ${item.workerName}`}>
      <header className={styles.cardHeader}>
        <div>
          <p className={styles.eyebrow}>{item.type.replaceAll("_", " ")}</p>
          <h2>{item.workerName}</h2>
        </div>
        <span className={styles.status} data-state={item.state}>{item.state.replaceAll("_", " ")}</span>
      </header>

      <dl className={styles.facts}>
        <div><dt>Hirer</dt><dd>{item.hirerName}</dd></div>
        <div><dt>Job</dt><dd>{item.jobName}</dd></div>
        <div><dt>Work date</dt><dd>{dateLabel(item.startsOn)}{item.endsOn && item.endsOn !== item.startsOn ? ` – ${dateLabel(item.endsOn)}` : ""}</dd></div>
        {item.siteName && <div><dt>Site</dt><dd>{item.siteName}</dd></div>}
        <div><dt>Age</dt><dd>{ageLabel(item.createdAt)}</dd></div>
      </dl>

      {item.cancelledAfterTravelAuthorised && (
        <p className={styles.travelWarning} role="note">Cancelled after travel was authorised</p>
      )}
      {item.travelAuthorisedAt && <p className={styles.meta}>Travel authorised {dateLabel(item.travelAuthorisedAt)}</p>}
      <p className={styles.summary}>{item.summary}</p>
      {!active && <p className={styles.nextAction}><strong>Resolution:</strong> {item.resolvedOutcome ?? "Resolved"}{item.resolutionReason ? ` · ${item.resolutionReason}` : ""}{item.resolvedAt ? ` · ${dateLabel(item.resolvedAt)}` : ""}{item.resolvedBy ? ` · actor ${item.resolvedBy}` : ""}</p>}
      {item.nextAction && <p className={styles.nextAction}><strong>Next action:</strong> {item.nextAction}</p>}

      <section className={styles.evidence} aria-labelledby={`evidence-${item.id}`}>
        <h3 id={`evidence-${item.id}`}>Workmark and Stamp evidence</h3>
        {item.evidence.length ? <ul>{item.evidence.map((entry) => <li key={`${entry.kind}-${entry.id}`}><strong>{entry.label}</strong>{entry.detail ? ` · ${entry.detail}` : ""}</li>)}</ul> : <p className={styles.meta}>No linked evidence in the projection.</p>}
      </section>

      <section className={styles.claims} aria-labelledby={`claims-${item.id}`}>
        <h3 id={`claims-${item.id}`}>Participant-separated claims</h3>
        {item.claims.length ? <ul>{item.claims.map((claim) => <li key={claim.id}><span className={styles.claimRole}>{claim.assertedRole ?? "participant"}</span><strong>{claim.assertedByName ?? (claim.assertedRole === "worker" ? item.workerName : claim.assertedRole === "hirer" ? item.hirerName : claim.assertedBy) ?? "Unknown person"}</strong><span>{claim.summary}</span><small>{claim.stance}{claim.sourceChannel ? ` · Source: ${claim.sourceChannel}` : ""}{claim.sourceReference ? ` · Reference: ${claim.sourceReference}` : ""}{claim.recordedBy ? ` · recorded by ${claim.recordedBy}` : ""}</small>{claim.evidenceRefs.length > 0 && <small>Evidence refs: {claim.evidenceRefs.join(", ")}</small>}</li>)}</ul> : <p className={styles.meta}>No claims recorded yet.</p>}
      </section>

      {active && <>
        <details className={styles.disclosure}>
          <summary>Add claim / operator note</summary>
          <form action={claimAction} className={styles.form}>
            <input name="exceptionId" type="hidden" value={item.id} />
            <input name="submissionNonce" type="hidden" value={claimNonce} />
            <label>Who asserted this?
              <select name="assertedRole" defaultValue="operator"><option value="operator">Operator note</option>{item.workerId && <option value="worker">Worker · {item.workerName}</option>}{item.hirerId && <option value="hirer">Hirer · {item.hirerName}</option>}</select>
            </label>
            <label>Participant (if applicable)
              <select name="assertedBy" defaultValue=""><option value="">Operator’s own note</option>{item.workerId && <option value={item.workerId}>Worker · {item.workerName}</option>}{item.hirerId && <option value={item.hirerId}>Hirer · {item.hirerName}</option>}</select>
            </label>
            <label>Claim or note<textarea name="summary" required minLength={3} maxLength={1000} rows={3} /></label>
            <label>Source<select name="source" defaultValue="operator_ui"><option value="operator_ui">Operator workspace</option><option value="call">Call</option><option value="in_person">In person</option></select></label>
            <ActionMessage state={claimState} />
            <button type="submit" disabled={claimPending}>{claimPending ? "Saving…" : "Add claim"}</button>
          </form>
        </details>
        {item.state === "under_review" && <details className={styles.disclosure}>
          <summary>Resolve exception</summary>
          <form action={resolveAction} className={styles.form}>
            <input name="exceptionId" type="hidden" value={item.id} />
            <input name="expectedVersion" type="hidden" value={item.version} />
            <input name="submissionNonce" type="hidden" value={resolveNonce} />
            <label>Outcome<select name="outcome" defaultValue="resolved"><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></label>
            <label>Resolution note<textarea name="resolution" required minLength={3} maxLength={1000} rows={3} /></label>
            <ActionMessage state={resolveState} />
            <button type="submit" disabled={resolvePending}>{resolvePending ? "Saving…" : "Save resolution"}</button>
          </form>
        </details>}
      </>}
    </article>
  );
}

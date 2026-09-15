"use client";

import { useActionState, useState } from "react";

import type { InboxItem } from "../../../features/ops-inbox/queries";
import {
  confirmProposedAction,
  rejectProposedAction,
  type InboxActionState,
} from "./actions";
import styles from "./inbox.module.css";

const confirmInitialState: InboxActionState = {};
const rejectInitialState: InboxActionState = {};

const riskTierLabels: Record<InboxItem["riskTier"], string> = {
  informational: "Informational",
  operational: "Operational",
  trust: "Trust",
  economic: "Economic",
};

export function InboxItemCard({ item }: { item: InboxItem }) {
  const [deferred, setDeferred] = useState(false);
  const [editing, setEditing] = useState(item.ambiguity !== "clear");
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmProposedAction,
    confirmInitialState,
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(
    rejectProposedAction,
    rejectInitialState,
  );

  if (deferred) return null;

  return (
    <article className={styles.card} aria-label={`Proposed ${item.actionType}`}>
      <header className={styles.cardHeader}>
        <span className={styles.riskBadge} data-tier={item.riskTier}>
          {riskTierLabels[item.riskTier]}
        </span>
        <span className={styles.ambiguityBadge} data-ambiguity={item.ambiguity}>
          {item.ambiguity}
        </span>
        <span>{item.senderPhoneNumber ?? "Unknown sender"}</span>
      </header>

      <p className={styles.sourceText}>
        <strong>Original:</strong> {item.originalText ?? "(voice note)"}
      </p>
      {item.transcript && (
        <p className={styles.sourceText}>
          <strong>Transcript:</strong> {item.transcript}
          {typeof item.transcriptConfidence === "number" && (
            <span className={styles.confidence}>
              {" "}
              ({Math.round(item.transcriptConfidence * 100)}% confidence)
            </span>
          )}
        </p>
      )}
      {!item.transcript && !item.originalText && (
        <p className={styles.sourceText}>Voice note pending transcription.</p>
      )}
      {item.detectedLanguageCode && (
        <p className={styles.meta}>
          Detected language: {item.detectedLanguageCode}
        </p>
      )}

      <h2 className={styles.intentHeading}>
        {item.actionType.replaceAll("_", " ")}
      </h2>
      <p className={styles.meta}>
        Confidence:{" "}
        {typeof item.confidence === "number"
          ? `${Math.round(item.confidence * 100)}%`
          : "unknown"}
      </p>

      {editing ? (
        <form action={confirmAction} className={styles.editForm}>
          <input name="id" type="hidden" value={item.id} />
          <input name="actionType" type="hidden" value={item.actionType} />
          <input name="ambiguity" type="hidden" value={item.ambiguity} />
          {Object.entries(item.fields).map(([key, value]) => (
            <label key={key}>
              {key}
              <input
                defaultValue={value === null ? "" : String(value)}
                name={`field.${key}`}
                required
              />
            </label>
          ))}
          {Object.entries(item.entityIds).map(([key, value]) => (
            <input
              key={key}
              name={`entity.${key}`}
              type="hidden"
              value={value}
            />
          ))}
          {confirmState.error && (
            <p role="alert" className={styles.error}>
              {confirmState.error}
            </p>
          )}
          <div className={styles.actions}>
            <button type="submit" disabled={confirmPending}>
              Confirm
            </button>
            {item.ambiguity === "clear" && (
              <button type="button" onClick={() => setEditing(false)}>
                Cancel edit
              </button>
            )}
          </div>
        </form>
      ) : (
        <form action={confirmAction} className={styles.actions}>
          <input name="id" type="hidden" value={item.id} />
          <input name="actionType" type="hidden" value={item.actionType} />
          <input name="ambiguity" type="hidden" value={item.ambiguity} />
          {Object.entries(item.fields).map(([key, value]) => (
            <input
              key={key}
              name={`field.${key}`}
              type="hidden"
              value={value === null ? "" : String(value)}
            />
          ))}
          {Object.entries(item.entityIds).map(([key, value]) => (
            <input
              key={key}
              name={`entity.${key}`}
              type="hidden"
              value={value}
            />
          ))}
          <button type="submit" disabled={confirmPending}>
            Confirm
          </button>
          <button type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
        </form>
      )}
      {confirmState.error && !editing && (
        <p role="alert" className={styles.error}>
          {confirmState.error}
        </p>
      )}

      <form action={rejectAction} className={styles.rejectForm}>
        <input name="id" type="hidden" value={item.id} />
        <label>
          Rejection reason
          <input name="reason" required />
        </label>
        <button type="submit" disabled={rejectPending}>
          Reject
        </button>
        {rejectState.error && (
          <p role="alert" className={styles.error}>
            {rejectState.error}
          </p>
        )}
      </form>

      <button
        type="button"
        className={styles.deferButton}
        onClick={() => setDeferred(true)}
      >
        Defer for later
      </button>
    </article>
  );
}

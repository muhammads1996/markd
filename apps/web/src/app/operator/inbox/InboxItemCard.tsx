"use client";

import { Check, Pencil, X } from "lucide-react";
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

function WorkCompletionFields({ item }: { item: InboxItem }) {
  const field = (name: string, fallback: string) => {
    const value = item.fields[name];
    return value === null || value === undefined ? fallback : String(value);
  };
  return (
    <>
      <p className={styles.meta}>
        Source assertion: {item.entityIds.assertedRole ?? "worker"}{" "}
        {item.entityIds.assertedById ?? item.entityIds.workerId ?? "unresolved"}
        <br />
        Assignment: {item.entityIds.assignmentId ?? "unresolved"}
      </p>
      <label>
        Attendance
        <select
          name="field.attendance"
          defaultValue={field("attendance", "unknown")}
        >
          <option value="attended">Attended</option>
          <option value="no_show">Did not attend</option>
          <option value="unknown">Not sure</option>
        </select>
      </label>
      <label>
        Completion
        <select
          name="field.completion"
          defaultValue={field("completion", "unknown")}
        >
          <option value="completed">Completed</option>
          <option value="partial">Partly completed</option>
          <option value="not_completed">Not completed</option>
          <option value="unknown">Not sure</option>
        </select>
      </label>
      <label>
        Work together again
        <select
          name="field.reuse_preference"
          defaultValue={field("reuse_preference", "unknown")}
        >
          <option value="yes">Yes</option>
          <option value="no">No</option>
          <option value="unknown">Not sure</option>
        </select>
      </label>
      <label>
        Payment state
        <select
          name="field.payment_state"
          defaultValue={field("payment_state", "unknown")}
        >
          <option value="unknown">Not sure</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="partial">Partly paid</option>
          <option value="disputed">Disputed</option>
        </select>
      </label>
      <label>
        Payment amount (minor units)
        <input
          name="field.amount_minor"
          type="number"
          min="0"
          defaultValue={field("amount_minor", "")}
        />
      </label>
      <label>
        Currency
        <input
          name="field.currency"
          minLength={3}
          maxLength={3}
          defaultValue={field("currency", "")}
        />
      </label>
      <label>
        Payment method
        <input
          name="field.payment_method"
          defaultValue={field("payment_method", "")}
        />
      </label>
      <label>
        Note
        <input name="field.note" defaultValue={field("note", "")} />
      </label>
    </>
  );
}

export function InboxItemCard({ item }: { item: InboxItem }) {
  const [editing, setEditing] = useState(
    item.ambiguity !== "clear" || item.actionType === "work_completion",
  );
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmProposedAction,
    confirmInitialState,
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(
    rejectProposedAction,
    rejectInitialState,
  );

  return (
    <article
      id={`proposed-action-${item.id}`}
      className={styles.card}
      aria-label={`Proposed ${item.actionType}`}
    >
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
      {item.sourceMediaAssetId && item.sourceMediaType === "audio" && (
        <p className={styles.sourceText}>
          <a
            href={`/api/operator/channel-media/${item.sourceMediaAssetId}`}
            rel="noreferrer"
            target="_blank"
          >
            Listen to source voice note
          </a>
        </p>
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
          {item.actionType === "work_completion" ? (
            <WorkCompletionFields item={item} />
          ) : (
            Object.entries(item.fields).map(([key, value]) => (
              <label key={key}>
                {key}
                <input
                  defaultValue={value === null ? "" : String(value)}
                  name={`field.${key}`}
                  required
                />
              </label>
            ))
          )}
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
              <Check aria-hidden="true" size={17} />
              Confirm
            </button>
            {item.ambiguity === "clear" &&
              item.actionType !== "work_completion" && (
                <button type="button" onClick={() => setEditing(false)}>
                  <X aria-hidden="true" size={17} />
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
            <Check aria-hidden="true" size={17} />
            Confirm
          </button>
          <button type="button" onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" size={17} />
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
          <X aria-hidden="true" size={17} />
          Reject
        </button>
        {rejectState.error && (
          <p role="alert" className={styles.error}>
            {rejectState.error}
          </p>
        )}
      </form>
    </article>
  );
}

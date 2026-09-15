"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ParticipantLocale } from "@markd/i18n";

import { formatAssignmentForSpeech } from "../../lib/participant/read-aloud";
import type { AssignmentViewModel } from "../../lib/participant/types";
import styles from "./participant.module.css";

export function BottomSheet({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="participant-sheet-title"
      aria-describedby="participant-sheet-description"
      onClose={onClose}
      onCancel={onClose}
    >
      <div className={styles.dialogHeader}>
        <div>
          <h2 id="participant-sheet-title">{title}</h2>
          <p id="participant-sheet-description" className={styles.muted}>
            {description}
          </p>
        </div>
        <button
          className={styles.iconButton}
          type="button"
          onClick={onClose}
          aria-label="Close"
        >
          <span aria-hidden="true">x</span>
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function ReadAloudButton({
  assignment,
  locale,
  label,
}: {
  assignment: AssignmentViewModel;
  locale: ParticipantLocale;
  label: string;
}) {
  const [status, setStatus] = useState("");

  function speak() {
    if (
      !("speechSynthesis" in window) ||
      !("SpeechSynthesisUtterance" in window)
    ) {
      setStatus("Read aloud is not supported on this device.");
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(
        formatAssignmentForSpeech(assignment, locale),
      );
      utterance.lang = locale;
      utterance.onerror = () =>
        setStatus("Unable to read this assignment aloud.");
      utterance.onend = () => setStatus("Finished reading assignment.");
      setStatus("Reading assignment.");
      window.speechSynthesis.speak(utterance);
    } catch {
      setStatus("Unable to read this assignment aloud.");
    }
  }

  return (
    <>
      <button
        className={`${styles.button} ${styles.ghost}`}
        type="button"
        onClick={speak}
      >
        <span aria-hidden="true">▶</span> {label}
      </button>
      <span role="status" className={styles.muted}>
        {status}
      </span>
    </>
  );
}

export function StampConfirmation({ children }: { children: ReactNode }) {
  return (
    <div className={styles.stamp} role="status">
      {children}
    </div>
  );
}

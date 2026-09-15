"use client";

import styles from "./contractor.module.css";

export default function ContractorError({ reset }: { reset: () => void }) {
  return (
    <main className={styles.page} role="alert">
      <p className={styles.header}>Contractor record</p>
      <h1>Contractor record is temporarily unavailable</h1>
      <p className={styles.empty}>
        Your records have not changed. Try again when you have a connection.
      </p>
      <button className={styles.retry} type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}

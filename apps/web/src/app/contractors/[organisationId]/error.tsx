"use client";

import { OperatorChrome } from "../../../components/operator/OperatorChrome";
import styles from "../../../components/operator/operator-record.module.css";

export default function ContractorError({ reset }: { reset: () => void }) {
  return (
    <OperatorChrome>
      <main className={styles.page} role="alert">
        <p className={styles.header}>Contractor record</p>
        <h1>Contractor record is temporarily unavailable</h1>
        <p className={styles.empty}>
          Your records have not changed. Try loading this page again.
        </p>
        <button className={styles.retry} type="button" onClick={reset}>
          Try again
        </button>
      </main>
    </OperatorChrome>
  );
}

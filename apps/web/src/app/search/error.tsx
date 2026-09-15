"use client";

import { OperatorChrome } from "../../components/operator/OperatorChrome";
import styles from "./search.module.css";

export default function SearchError({ reset }: { reset: () => void }) {
  return (
    <OperatorChrome>
      <main className={styles.page} role="alert">
        <p className={styles.eyebrow}>Work Graph</p>
        <h1>Search is temporarily unavailable</h1>
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

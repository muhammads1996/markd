"use client";

import styles from "./search.module.css";

export default function SearchError({ reset }: { reset: () => void }) {
  return (
    <main className={styles.page} role="alert">
      <p className={styles.eyebrow}>Work Graph</p>
      <h1>Search is temporarily unavailable</h1>
      <p className={styles.empty}>
        Your records have not changed. Try again when you have a connection.
      </p>
      <button className={styles.retry} type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}

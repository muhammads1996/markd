import styles from "./worker.module.css";

export default function WorkerLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-live="polite">
      <p className={styles.header}>Loading worker record</p>
      <p className={styles.empty}>
        Getting work history and relationships ready.
      </p>
    </main>
  );
}

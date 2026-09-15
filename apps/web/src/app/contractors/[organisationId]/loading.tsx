import styles from "./contractor.module.css";

export default function ContractorLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-live="polite">
      <p className={styles.header}>Loading contractor record</p>
      <p className={styles.empty}>
        Getting the labour network and work history ready.
      </p>
    </main>
  );
}

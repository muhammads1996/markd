import styles from "./search.module.css";

export default function SearchLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-live="polite">
      <p className={styles.eyebrow}>Work Graph</p>
      <h1>Loading search</h1>
      <p className={styles.empty}>Getting the private Work Graph ready.</p>
    </main>
  );
}

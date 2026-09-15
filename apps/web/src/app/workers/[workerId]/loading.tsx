import { OperatorChrome } from "../../../components/operator/OperatorChrome";
import styles from "../../../components/operator/operator-record.module.css";

export default function WorkerLoading() {
  return (
    <OperatorChrome>
      <main className={styles.page} aria-busy="true" aria-live="polite">
        <p className={styles.header}>Loading worker record</p>
        <p className={styles.empty}>
          Getting work history and relationships ready.
        </p>
      </main>
    </OperatorChrome>
  );
}

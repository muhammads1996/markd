import {
  WorkerAvailabilityCommand,
  participantStyles as styles,
} from "../../../../components/participant";
import { requireParticipantScope } from "../../../../lib/participant/auth";

export default async function Page() {
  const { personId } = await requireParticipantScope("worker");

  return (
    <>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Profile</p>
        <h1 className={styles.title}>Your settings</h1>
        <p className={styles.lede}>
          Keep your availability current for your MARKD operator.
        </p>
      </header>
      <section className={styles.card}>
        <WorkerAvailabilityCommand workerId={personId} currentStatus={null} />
      </section>
    </>
  );
}

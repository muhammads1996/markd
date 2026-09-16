import {
  ContractorHireForm,
  participantStyles as styles,
} from "../../../../components/participant";
import { requireParticipantScope } from "../../../../lib/participant/auth";

export default async function Page() {
  await requireParticipantScope("contractor");
  return (
    <>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Hire</p>
        <h1 className={styles.title}>Request workers</h1>
        <p className={styles.lede}>
          Submit the work details for MARKD to review and fulfil.
        </p>
      </header>
      <section className={styles.card}>
        <ContractorHireForm />
      </section>
    </>
  );
}

import {
  ContractorAssignmentList,
  EmptyState,
  participantStyles as styles,
} from "../../../../components/participant";
import { requireParticipantScope } from "../../../../lib/participant/auth";
import { loadParticipantContractorAssignments } from "../../../../lib/participant/queries.server";

export default async function Page() {
  await requireParticipantScope("contractor");
  const assignments = await loadParticipantContractorAssignments();

  return (
    <>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Jobs</p>
        <h1 className={styles.title}>Your jobs</h1>
        <p className={styles.lede}>Confirm workers and prepare work details.</p>
      </header>
      {assignments.length ? (
        <ContractorAssignmentList assignments={assignments} />
      ) : (
        <EmptyState title="No jobs to show">
          <p>Your jobs will appear here when MARKD creates assignments.</p>
        </EmptyState>
      )}
    </>
  );
}

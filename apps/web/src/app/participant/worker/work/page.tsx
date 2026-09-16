import {
  EmptyState,
  WorkerAssignmentList,
  participantStyles as styles,
} from "../../../../components/participant";
import { requireParticipantScope } from "../../../../lib/participant/auth";
import { loadParticipantWorkerAssignments } from "../../../../lib/participant/queries.server";

export default async function Page() {
  const { personId } = await requireParticipantScope("worker");
  const assignments = await loadParticipantWorkerAssignments(personId);

  return (
    <>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Work</p>
        <h1 className={styles.title}>Assigned work</h1>
        <p className={styles.lede}>
          Current and completed work assigned through MARKD.
        </p>
      </header>
      {assignments.length ? (
        <WorkerAssignmentList assignments={assignments} />
      ) : (
        <EmptyState title="No assigned work to show">
          <p>
            Your MARKD operator remains available for questions and changes.
          </p>
        </EmptyState>
      )}
    </>
  );
}

import {
  StatusPill,
  WorkerAssignmentCommands,
  participantStyles as styles,
} from ".";
import {
  getAssignmentStatusTone,
  type AssignmentStatusTone,
} from "../../lib/participant/types";
import {
  toWorkerAssignmentCardModel,
  type ParticipantWorkerAssignment,
} from "../../lib/participant/queries";

function assignmentLabel(assignment: ParticipantWorkerAssignment): string {
  if (assignment.lifecycle === "completed") return "Completed";
  if (assignment.lifecycle === "no_show") return "No show recorded";
  const card = toWorkerAssignmentCardModel(assignment);
  if (card?.state === "travel_ready") return "Travel ready";
  if (card?.state === "accepted_waiting") return "Accepted";
  if (card?.state === "cancelled") return "Cancelled";
  return "Work offer";
}

function assignmentTone(
  assignment: ParticipantWorkerAssignment,
): AssignmentStatusTone {
  if (assignment.lifecycle === "completed") return "confirmed";
  if (assignment.lifecycle === "no_show") return "danger";
  const card = toWorkerAssignmentCardModel(assignment);
  return card ? getAssignmentStatusTone(card.status) : "neutral";
}

export function WorkerAssignmentList({
  assignments,
}: {
  assignments: readonly ParticipantWorkerAssignment[];
}) {
  return (
    <section className={styles.stack} aria-label="Assigned work">
      {assignments.map((assignment) => (
        <article className={styles.card} key={assignment.assignmentId}>
          <div className={styles.row}>
            <StatusPill tone={assignmentTone(assignment)}>
              {assignmentLabel(assignment)}
            </StatusPill>
            <strong>{assignment.workDate}</strong>
          </div>
          <h2>{assignment.workType}</h2>
          <p>
            {assignment.organisationDisplayName ?? "MARKD contractor"} -{" "}
            {[assignment.siteName, assignment.siteLocality]
              .filter(Boolean)
              .join(", ") || "Site to be confirmed"}
          </p>
          <div className={styles.facts}>
            <div>
              <span className={styles.factLabel}>Reporting</span>
              <strong>{assignment.reportingPlace ?? "To be confirmed"}</strong>
            </div>
          </div>
          <WorkerAssignmentCommands assignment={assignment} />
        </article>
      ))}
    </section>
  );
}

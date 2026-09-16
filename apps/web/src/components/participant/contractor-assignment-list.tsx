"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { ParticipantContractorAssignment } from "../../lib/participant/queries";
import {
  authoriseAssignmentTravel,
  cancelContractorAssignment,
  confirmAssignment,
  setAssignmentLogistics,
  submitStamp,
} from "../../lib/participant/commands";
import {
  AssignmentCloseoutFields,
  stampInputFromFormData,
} from "./participant-commands";
import { Button, StatusPill, participantStyles as styles } from "./components";

function assignmentLabel(assignment: ParticipantContractorAssignment): string {
  if (assignment.lifecycle === "completed") return "Completed";
  if (assignment.lifecycle === "no_show") return "No show recorded";
  if (assignment.lifecycle === "cancelled") return "Cancelled";
  if (assignment.travelAuthorisedAt) return "Travel authorised";
  if (assignment.contractorConfirmation === "confirmed") return "Confirmed";
  return "Needs confirmation";
}

export function ContractorAssignmentList({
  assignments,
}: {
  assignments: readonly ParticipantContractorAssignment[];
}) {
  return (
    <section className={styles.stack} aria-label="Contractor jobs">
      {assignments.map((assignment) => (
        <ContractorAssignmentCard
          key={assignment.assignmentId}
          assignment={assignment}
        />
      ))}
    </section>
  );
}

function ContractorAssignmentCard({
  assignment,
}: {
  assignment: ParticipantContractorAssignment;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(command: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await command();
      router.refresh();
    } catch (commandError) {
      setError(
        commandError instanceof Error
          ? commandError.message
          : "Request failed.",
      );
    } finally {
      setPending(false);
    }
  }

  function submitLogistics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const reportingAt = new Date(
      String(formData.get("reporting_at")),
    ).toISOString();
    void run(() =>
      setAssignmentLogistics(assignment.assignmentId, {
        reportingMode: formData.get("reporting_mode") as "site" | "pickup",
        placeText: String(formData.get("place_text")),
        reportingAt,
        expectedVersion: assignment.version,
      }),
    );
  }

  function submitStampForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void run(() =>
      submitStamp(
        assignment.assignmentId,
        stampInputFromFormData(formData, assignment.version),
      ),
    );
  }

  const active = assignment.lifecycle === "active";
  const logisticsComplete = Boolean(
    assignment.reportingMode &&
    assignment.reportingPlace &&
    assignment.reportingAt,
  );
  const canAuthoriseTravel =
    active &&
    assignment.workerResponse === "accepted" &&
    assignment.contractorConfirmation === "confirmed" &&
    logisticsComplete &&
    assignment.travelAuthorisedAt === null;
  const canStamp = ["active", "completed", "no_show"].includes(
    assignment.lifecycle,
  );

  return (
    <article className={styles.card}>
      <div className={styles.row}>
        <StatusPill tone={active ? "neutral" : "confirmed"}>
          {assignmentLabel(assignment)}
        </StatusPill>
        <strong>{assignment.workDate}</strong>
      </div>
      <h2>{assignment.workType}</h2>
      <p>{assignment.workerDisplayName}</p>
      <div className={styles.facts}>
        <div>
          <span className={styles.factLabel}>Worker response</span>
          <strong>{assignment.workerResponse}</strong>
        </div>
        <div>
          <span className={styles.factLabel}>Reporting</span>
          <strong>{assignment.reportingPlace ?? "To be confirmed"}</strong>
        </div>
      </div>
      {active ? (
        <div className={styles.actions}>
          <Button
            disabled={
              pending || assignment.contractorConfirmation === "confirmed"
            }
            onClick={() =>
              void run(() =>
                confirmAssignment(
                  assignment.assignmentId,
                  true,
                  assignment.version,
                ),
              )
            }
          >
            Confirm worker
          </Button>
          <Button
            variant="secondary"
            disabled={
              pending || assignment.contractorConfirmation === "rejected"
            }
            onClick={() =>
              void run(() =>
                confirmAssignment(
                  assignment.assignmentId,
                  false,
                  assignment.version,
                ),
              )
            }
          >
            Reject worker
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              void run(() =>
                cancelContractorAssignment(
                  assignment.assignmentId,
                  assignment.version,
                ),
              )
            }
          >
            Cancel assignment
          </Button>
        </div>
      ) : null}
      {active ? (
        <form className={styles.stack} onSubmit={submitLogistics}>
          <label>
            Reporting mode
            <select
              name="reporting_mode"
              defaultValue={assignment.reportingMode ?? "site"}
              disabled={pending}
            >
              <option value="site">Site</option>
              <option value="pickup">Pickup</option>
            </select>
          </label>
          <label>
            Reporting place
            <input
              name="place_text"
              defaultValue={assignment.reportingPlace ?? ""}
              required
              maxLength={500}
              disabled={pending}
            />
          </label>
          <label>
            Reporting time
            <input
              name="reporting_at"
              type="datetime-local"
              required
              disabled={pending}
            />
          </label>
          <Button type="submit" disabled={pending}>
            Save logistics
          </Button>
        </form>
      ) : null}
      {canAuthoriseTravel ? (
        <Button
          disabled={pending}
          onClick={() =>
            void run(() =>
              authoriseAssignmentTravel(
                assignment.assignmentId,
                assignment.version,
              ),
            )
          }
        >
          Authorise travel
        </Button>
      ) : null}
      {canStamp ? (
        <form className={styles.stack} onSubmit={submitStampForm}>
          <AssignmentCloseoutFields disabled={pending} />
          <Button type="submit" disabled={pending}>
            Stamp work
          </Button>
        </form>
      ) : null}
      {error ? <p className={styles.warningText}>{error}</p> : null}
    </article>
  );
}

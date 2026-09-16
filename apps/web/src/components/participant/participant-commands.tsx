"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { ParticipantWorkerAssignment } from "../../lib/participant/queries";
import {
  acknowledgeOnMyWay,
  cancelAssignment,
  respondToAssignment,
  setWorkerAvailability,
  submitStamp,
} from "../../lib/participant/commands";
import { Button, participantStyles as styles } from "./components";

function CommandError({ error }: { error: string | null }) {
  return error ? <p className={styles.warningText}>{error}</p> : null;
}

export function WorkerAssignmentCommands({
  assignment,
}: {
  assignment: ParticipantWorkerAssignment;
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

  function submitStampForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void run(() =>
      submitStamp(assignment.assignmentId, {
        attendance: formData.get("attendance") as
          "attended" | "no_show" | "unknown",
        completion: formData.get("completion") as
          "completed" | "partial" | "not_completed" | "unknown",
        expectedVersion: assignment.assignmentVersion,
      }),
    );
  }

  const canRespond =
    assignment.lifecycle === "active" &&
    assignment.offeredAt !== null &&
    assignment.workerResponse === "pending";
  const canAcknowledge =
    assignment.lifecycle === "active" &&
    assignment.workerResponse === "accepted" &&
    assignment.contractorConfirmation === "confirmed" &&
    assignment.travelAuthorisedAt !== null;
  const canWithdraw =
    assignment.lifecycle === "active" &&
    assignment.workerResponse === "accepted";
  const canStamp = ["active", "completed"].includes(assignment.lifecycle);

  return (
    <section className={styles.stack} aria-label="Work actions">
      {canRespond ? (
        <div className={styles.actions}>
          <Button
            disabled={pending}
            onClick={() =>
              void run(() =>
                respondToAssignment(
                  assignment.assignmentId,
                  "accepted",
                  assignment.assignmentVersion,
                ),
              )
            }
          >
            Accept work
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              void run(() =>
                respondToAssignment(
                  assignment.assignmentId,
                  "declined",
                  assignment.assignmentVersion,
                ),
              )
            }
          >
            Decline
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              void run(() =>
                respondToAssignment(
                  assignment.assignmentId,
                  "call_me",
                  assignment.assignmentVersion,
                ),
              )
            }
          >
            Ask for a call
          </Button>
        </div>
      ) : null}
      {canAcknowledge ? (
        <Button
          disabled={pending}
          onClick={() =>
            void run(() => acknowledgeOnMyWay(assignment.assignmentId))
          }
        >
          On my way
        </Button>
      ) : null}
      {canWithdraw ? (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            void run(() =>
              cancelAssignment(
                assignment.assignmentId,
                assignment.assignmentVersion,
              ),
            )
          }
        >
          Withdraw from this work
        </Button>
      ) : null}
      {canStamp ? (
        <form className={styles.stack} onSubmit={submitStampForm}>
          <label>
            Attendance
            <select
              name="attendance"
              defaultValue="attended"
              disabled={pending}
            >
              <option value="attended">Attended</option>
              <option value="no_show">Did not attend</option>
              <option value="unknown">Not sure</option>
            </select>
          </label>
          <label>
            Work completed
            <select
              name="completion"
              defaultValue="completed"
              disabled={pending}
            >
              <option value="completed">Completed</option>
              <option value="partial">Partly completed</option>
              <option value="not_completed">Not completed</option>
              <option value="unknown">Not sure</option>
            </select>
          </label>
          <Button type="submit" disabled={pending}>
            Stamp work
          </Button>
        </form>
      ) : null}
      <CommandError error={error} />
    </section>
  );
}

export function WorkerAvailabilityCommand({
  workerId,
  currentStatus,
}: {
  workerId: string;
  currentStatus: "available" | "unavailable" | "unknown" | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await setWorkerAvailability(
        workerId,
        String(formData.get("work_date")),
        formData.get("status") as "available" | "unavailable" | "unknown",
      );
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

  return (
    <form className={styles.stack} onSubmit={submit}>
      <label>
        Date
        <input name="work_date" type="date" required disabled={pending} />
      </label>
      <label>
        Availability
        <select
          name="status"
          defaultValue={currentStatus ?? "unknown"}
          disabled={pending}
        >
          <option value="available">Available</option>
          <option value="unavailable">Unavailable</option>
          <option value="unknown">Not sure</option>
        </select>
      </label>
      <Button type="submit" disabled={pending}>
        Save availability
      </Button>
      <CommandError error={error} />
    </form>
  );
}

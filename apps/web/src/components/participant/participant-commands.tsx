"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  toParticipantWorkerAvailability,
  type ParticipantWorkerAssignment,
  type ParticipantWorkerAvailability,
} from "../../lib/participant/queries";
import {
  acknowledgeOnMyWay,
  cancelAssignment,
  respondToAssignment,
  setWorkerAvailability,
  submitStamp,
  type AssignmentStampCommandInput,
} from "../../lib/participant/commands";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { Button, participantStyles as styles } from "./components";

function CommandError({ error }: { error: string | null }) {
  return error ? <p className={styles.warningText}>{error}</p> : null;
}

export function stampInputFromFormData(
  formData: FormData,
  expectedVersion: number,
): AssignmentStampCommandInput {
  const amount = String(formData.get("amount_minor") ?? "").trim();
  const currency = String(formData.get("currency") ?? "").trim();
  const method = String(formData.get("payment_method") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const payment = {
    state: formData.get(
      "payment_state",
    ) as AssignmentStampCommandInput["payment"]["state"],
    ...(amount ? { amountMinor: Number(amount) } : {}),
    ...(amount ? { currency: currency.toUpperCase() } : {}),
    ...(method ? { method } : {}),
  };
  return {
    attendance: formData.get(
      "attendance",
    ) as AssignmentStampCommandInput["attendance"],
    completion: formData.get(
      "completion",
    ) as AssignmentStampCommandInput["completion"],
    reusePreference: formData.get(
      "reuse_preference",
    ) as AssignmentStampCommandInput["reusePreference"],
    payment,
    ...(note ? { note } : {}),
    expectedVersion,
  };
}

export function AssignmentCloseoutFields({ disabled }: { disabled: boolean }) {
  return (
    <>
      <label>
        Attendance
        <select name="attendance" defaultValue="attended" disabled={disabled}>
          <option value="attended">Attended</option>
          <option value="no_show">Did not attend</option>
          <option value="unknown">Not sure</option>
        </select>
      </label>
      <label>
        Work completed
        <select name="completion" defaultValue="completed" disabled={disabled}>
          <option value="completed">Completed</option>
          <option value="partial">Partly completed</option>
          <option value="not_completed">Not completed</option>
          <option value="unknown">Not sure</option>
        </select>
      </label>
      <label>
        Work together again
        <select
          name="reuse_preference"
          defaultValue="unknown"
          disabled={disabled}
        >
          <option value="yes">Yes</option>
          <option value="no">No</option>
          <option value="unknown">Not sure</option>
        </select>
      </label>
      <label>
        Payment state
        <select name="payment_state" defaultValue="unknown" disabled={disabled}>
          <option value="unknown">Not sure</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="partial">Partly paid</option>
          <option value="disputed">Disputed</option>
        </select>
      </label>
      <label>
        Payment amount (minor units)
        <input name="amount_minor" type="number" min="0" disabled={disabled} />
      </label>
      <label>
        Payment currency
        <input
          name="currency"
          defaultValue="ZAR"
          minLength={3}
          maxLength={3}
          disabled={disabled}
        />
      </label>
      <label>
        Payment method
        <input name="payment_method" maxLength={80} disabled={disabled} />
      </label>
      <label>
        Note
        <textarea name="note" maxLength={2000} disabled={disabled} />
      </label>
    </>
  );
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
      submitStamp(
        assignment.assignmentId,
        stampInputFromFormData(formData, assignment.assignmentVersion),
      ),
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
  const canStamp = ["active", "completed", "no_show"].includes(
    assignment.lifecycle,
  );

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
          <AssignmentCloseoutFields disabled={pending} />
          <Button type="submit" disabled={pending}>
            Stamp work
          </Button>
        </form>
      ) : null}
      <CommandError error={error} />
    </section>
  );
}

export function WorkerAvailabilityCommand({ workerId }: { workerId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workDate, setWorkDate] = useState("");
  const [status, setStatus] =
    useState<ParticipantWorkerAvailability["status"]>("unknown");
  const [note, setNote] = useState("");
  const [version, setVersion] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    if (!workDate) return undefined;
    void (async () => {
      const supabase = createSupabaseBrowserClient();
      const { data, error: queryError } = await supabase
        .from("participant_worker_availability")
        .select("worker_id, work_date, status, note, version")
        .eq("worker_id", workerId)
        .eq("work_date", workDate)
        .maybeSingle();
      if (!active) return;
      if (queryError) {
        setError(`Could not load availability: ${queryError.message}`);
        return;
      }
      const availability = data ? toParticipantWorkerAvailability(data) : null;
      setStatus(availability?.status ?? "unknown");
      setNote(availability?.note ?? "");
      setVersion(availability?.version ?? null);
    })();
    return () => {
      active = false;
    };
  }, [workDate, workerId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workDate) {
      setError("Choose a date before saving availability.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await setWorkerAvailability(
        workerId,
        workDate,
        status,
        version ?? undefined,
        note || undefined,
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
        <input
          name="work_date"
          type="date"
          value={workDate}
          onChange={(event) => {
            setWorkDate(event.target.value);
            setStatus("unknown");
            setNote("");
            setVersion(null);
          }}
          disabled={pending}
        />
      </label>
      <label>
        Availability
        <select
          name="status"
          value={status}
          onChange={(event) =>
            setStatus(
              event.target.value as ParticipantWorkerAvailability["status"],
            )
          }
          disabled={pending}
        >
          <option value="available">Available</option>
          <option value="unavailable">Unavailable</option>
          <option value="unknown">Not sure</option>
        </select>
      </label>
      <label>
        Note
        <textarea
          name="note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={2000}
          disabled={pending}
        />
      </label>
      <Button type="submit" disabled={pending}>
        Save availability
      </Button>
      <CommandError error={error} />
    </form>
  );
}

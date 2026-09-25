"use client";

import { useState } from "react";

import {
  authoriseAssignmentTravel,
  confirmAssignment,
  respondToAssignment,
  sendParticipantApiRequest,
  setAssignmentLogistics,
} from "../../../lib/participant/commands";

type Props = {
  assignmentId: string;
  version: number;
  bucket: string;
  contractorConfirmation: string;
  offeredAt: string | null;
  blockers: string[];
  timezone: string;
};

// Interpret a wall-clock value in the request's canonical timezone, never the
// operator browser's timezone. Reject nonexistent local times at DST changes.
function reportingInstant(localValue: string, timezone: string): string {
  const nominal = Date.parse(`${localValue}:00Z`);
  if (!Number.isFinite(nominal))
    throw new Error("Enter a valid reporting time.");
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const wall = (instant: number) => {
    const fields = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .map((part) => [part.type, part.value]),
    );
    return Date.UTC(
      Number(fields.year),
      Number(fields.month) - 1,
      Number(fields.day),
      Number(fields.hour),
      Number(fields.minute),
    );
  };
  let instant = nominal;
  for (let attempt = 0; attempt < 3; attempt += 1)
    instant += nominal - wall(instant);
  if (wall(instant) !== nominal)
    throw new Error("That local time does not exist in the work timezone.");
  return new Date(instant).toISOString();
}

export function TomorrowActions({
  assignmentId,
  version,
  bucket,
  contractorConfirmation,
  offeredAt,
  blockers,
  timezone,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reportingMode, setReportingMode] = useState<"site" | "pickup">("site");
  const [placeText, setPlaceText] = useState("");
  const [reportingAt, setReportingAt] = useState("");
  const [workerResponse, setWorkerResponse] = useState<
    "accepted" | "declined" | "call_me"
  >("accepted");
  const [cancelReason, setCancelReason] = useState<
    "operator_cancelled" | "worker_withdrew" | "contractor_cancelled" | "other"
  >("operator_cancelled");
  const [cancelNote, setCancelNote] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await action();
      // A successful command increments the canonical optimistic-lock version.
      // Keep controls disabled until a fresh server projection replaces this page.
      window.location.reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Action could not be completed.",
      );
      setPending(false);
    }
  };

  if (bucket === "cancelled") return null;
  return (
    <div className="tomorrow-actions">
      {bucket === "awaiting_worker_response" ||
      (bucket === "informational" && !offeredAt) ? (
        <button
          disabled={pending}
          onClick={() =>
            run(() =>
              sendParticipantApiRequest({
                path: `/api/v1/assignments/${assignmentId}/offer`,
                method: "POST",
                body: { expected_version: version },
                idempotencyKey: `assignment-reoffer-${assignmentId}-${crypto.randomUUID()}`,
              }),
            )
          }
          type="button"
        >
          {offeredAt ? "Re-offer worker" : "Send offer"}
        </button>
      ) : null}
      {bucket === "awaiting_worker_response" ? (
        <details>
          <summary>Record worker response</summary>
          <p>
            Use only after hearing directly from the worker. Delivery/read
            receipts are not acceptance.
          </p>
          <label>
            Worker said
            <select
              value={workerResponse}
              onChange={(event) =>
                setWorkerResponse(event.target.value as typeof workerResponse)
              }
            >
              <option value="accepted">Accepted</option>
              <option value="declined">Declined</option>
              <option value="call_me">Call me</option>
            </select>
          </label>
          <button
            disabled={pending}
            onClick={() =>
              run(() =>
                respondToAssignment(assignmentId, workerResponse, version),
              )
            }
            type="button"
          >
            Record response
          </button>
        </details>
      ) : null}
      {bucket === "accepted_waiting" && contractorConfirmation === "pending" ? (
        <button
          disabled={pending}
          onClick={() =>
            run(() => confirmAssignment(assignmentId, true, version))
          }
          type="button"
        >
          Confirm assignment
        </button>
      ) : null}
      {bucket === "accepted_waiting" &&
      blockers.includes("Reporting or pickup details required") ? (
        <details>
          <summary>Set logistics</summary>
          <label>
            Reporting mode
            <select
              value={reportingMode}
              onChange={(event) =>
                setReportingMode(event.target.value as "site" | "pickup")
              }
            >
              <option value="site">Site</option>
              <option value="pickup">Pickup</option>
            </select>
          </label>
          <label>
            Site or pickup location
            <input
              required
              value={placeText}
              onChange={(event) => setPlaceText(event.target.value)}
            />
          </label>
          <label>
            Reporting time
            <input
              required
              type="datetime-local"
              value={reportingAt}
              onChange={(event) => setReportingAt(event.target.value)}
            />
          </label>
          <small>Local work time ({timezone})</small>
          <button
            disabled={pending || !placeText || !reportingAt}
            onClick={() =>
              run(() =>
                setAssignmentLogistics(assignmentId, {
                  reportingMode,
                  placeText,
                  reportingAt: reportingInstant(reportingAt, timezone),
                  expectedVersion: version,
                }),
              )
            }
            type="button"
          >
            Save logistics
          </button>
        </details>
      ) : null}
      <details data-danger="true">
        <summary>Cancel assignment</summary>
        <p>
          Cancellation may notify the worker through the normal communication
          policy. Check the reason before continuing.
        </p>
        <label>
          Reason
          <select
            value={cancelReason}
            onChange={(event) =>
              setCancelReason(event.target.value as typeof cancelReason)
            }
          >
            <option value="operator_cancelled">Operator cancelled</option>
            <option value="worker_withdrew">Worker withdrew</option>
            <option value="contractor_cancelled">Hirer cancelled</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Context for the case record
          <textarea
            value={cancelNote}
            onChange={(event) => setCancelNote(event.target.value)}
            maxLength={1000}
          />
        </label>
        <button
          disabled={pending || !cancelNote.trim()}
          onClick={() => {
            if (
              !window.confirm(
                "Cancel this assignment? If travel was authorised, the worker must be told not to travel.",
              )
            )
              return;
            void run(() =>
              sendParticipantApiRequest({
                path: `/api/v1/assignments/${assignmentId}/cancel`,
                method: "POST",
                body: {
                  reason_code: cancelReason,
                  reason_text: cancelNote.trim(),
                  expected_version: version,
                },
                idempotencyKey: `tomorrow-cancel-assignment-${assignmentId}-${crypto.randomUUID()}`,
              }),
            );
          }}
          type="button"
        >
          Confirm cancellation
        </button>
      </details>
      {bucket === "accepted_waiting" &&
      blockers.length === 1 &&
      blockers[0] === "Travel authorisation required" ? (
        <button
          disabled={pending}
          onClick={() =>
            run(() => authoriseAssignmentTravel(assignmentId, version))
          }
          type="button"
        >
          Authorise travel
        </button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  authoriseAssignmentTravel,
  confirmAssignment,
  sendParticipantApiRequest,
  setAssignmentLogistics,
} from "../../../lib/participant/commands";

type Props = {
  assignmentId: string;
  version: number;
  bucket: string;
  contractorConfirmation: string;
  blockers: string[];
};

export function TomorrowActions({
  assignmentId,
  version,
  bucket,
  contractorConfirmation,
  blockers,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reportingMode, setReportingMode] = useState<"site" | "pickup">("site");
  const [placeText, setPlaceText] = useState("");
  const [reportingAt, setReportingAt] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Action could not be completed.",
      );
    } finally {
      setPending(false);
    }
  };

  if (bucket === "travel_ready" || bucket === "cancelled") return null;
  return (
    <div className="tomorrow-actions">
      {bucket === "awaiting_worker_response" ? (
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
          Re-offer worker
        </button>
      ) : null}
      {bucket === "accepted_waiting" &&
      contractorConfirmation !== "confirmed" ? (
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
          <button
            disabled={pending || !placeText || !reportingAt}
            onClick={() =>
              run(() =>
                setAssignmentLogistics(assignmentId, {
                  reportingMode,
                  placeText,
                  reportingAt: new Date(reportingAt).toISOString(),
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

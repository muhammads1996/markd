"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { sendParticipantApiRequest } from "../../../lib/participant/commands";

type OfferTarget = {
  requestId: string;
  requirementId: string;
  workType: string;
  siteArea: string | null;
  date: string;
};

export function TomorrowOfferAction({
  workerId,
  workerName,
  target,
}: {
  workerId: string;
  workerName: string;
  target: OfferTarget;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offer = async () => {
    setPending(true);
    setError(null);
    let assignmentCreated = false;
    try {
      const created = await sendParticipantApiRequest<{
        assignments: string[];
      }>({
        path: `/api/v1/labour-requests/${target.requestId}/assignments`,
        method: "POST",
        body: {
          requirement_id: target.requirementId,
          worker_ids: [workerId],
        },
        idempotencyKey: `tomorrow-select-worker-${target.requestId}-${workerId}-${crypto.randomUUID()}`,
      });
      const assignmentId = created.assignments[0];
      if (!assignmentId)
        throw new Error("Assignment was not returned by the service.");
      assignmentCreated = true;
      await sendParticipantApiRequest({
        path: `/api/v1/assignments/${assignmentId}/offer`,
        method: "POST",
        body: {},
        idempotencyKey: `tomorrow-offer-worker-${assignmentId}-${crypto.randomUUID()}`,
      });
      router.push(`/operator/tomorrow?date=${encodeURIComponent(target.date)}`);
      router.refresh();
    } catch (cause) {
      setError(
        assignmentCreated
          ? "The Assignment exists, but the offer did not complete. Return to Tomorrow and send the offer; do not assume the worker was contacted."
          : cause instanceof Error
            ? cause.message
            : "Worker could not be selected.",
      );
      setPending(false);
    }
  };

  return (
    <div>
      <button type="button" onClick={offer} disabled={pending}>
        {pending ? "Offering…" : `Offer ${workerName}`}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

import { NextResponse } from "next/server";

import {
  buildOutboundDeliveryRow,
  WhatsAppProviderError,
} from "@markd/messaging";
import { isInternalServiceRequestAuthorized } from "@/lib/internal-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getWhatsAppProvider } from "@/lib/whatsapp/providers";

type DeliveryRow = {
  id: string;
  recipient_phone_number: string;
  body: string;
};

type QueueDeliveryInput = {
  recipientPhoneNumber: string;
  body: string;
  messageKind: string;
  idempotencyKey: string;
};

/**
 * Internal scheduler/test endpoint. It can queue a supplied test delivery,
 * then leases and sends ready deliveries. This route is never browser-facing.
 */
export async function POST(request: Request) {
  if (!isInternalServiceRequestAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const queued = await parseQueueDelivery(request);
  if (queued instanceof NextResponse) return queued;

  let provider;
  try {
    provider = getWhatsAppProvider();
  } catch {
    return NextResponse.json(
      { error: "WhatsApp provider configuration is unavailable" },
      { status: 503 },
    );
  }
  const client = createSupabaseAdminClient();
  if (queued) {
    const { error: queueError } = await client
      .from("channel_deliveries")
      .insert(buildOutboundDeliveryRow(queued));
    if (queueError && queueError.code !== "23505") {
      return NextResponse.json(
        { error: "delivery queue persistence failed" },
        { status: 503 },
      );
    }
  }

  const { error: recoveryError } = await client.rpc(
    "requeue_expired_channel_deliveries",
  );
  if (recoveryError) {
    return NextResponse.json(
      { error: "delivery recovery failed" },
      { status: 503 },
    );
  }
  const { data: deliveries, error: claimError } = await client.rpc(
    "claim_channel_deliveries",
    { batch_size: 10 },
  );
  if (claimError) {
    return NextResponse.json(
      { error: "delivery claim failed" },
      { status: 503 },
    );
  }

  const results: Array<{ deliveryId: string; outcome: "sent" | "failed" }> = [];
  for (const delivery of (deliveries ?? []) as DeliveryRow[]) {
    try {
      const sent = await provider.sendText({
        recipientPhoneNumber: delivery.recipient_phone_number,
        body: delivery.body,
      });
      const { error: completionError } = await client.rpc(
        "complete_channel_delivery",
        {
          delivery_id: delivery.id,
          succeeded: true,
          reported_provider_message_id: sent.providerMessageId,
          error_message: null,
          retryable: false,
        },
      );
      if (completionError) throw new Error("delivery completion failed");
      results.push({ deliveryId: delivery.id, outcome: "sent" });
    } catch (error) {
      const failure = deliveryFailure(error);
      await client.rpc("complete_channel_delivery", {
        delivery_id: delivery.id,
        succeeded: false,
        reported_provider_message_id: null,
        error_message: failure.message,
        retryable: failure.retryable,
      });
      results.push({ deliveryId: delivery.id, outcome: "failed" });
    }
  }

  return NextResponse.json({ dispatched: results.length, results });
}

async function parseQueueDelivery(
  request: Request,
): Promise<QueueDeliveryInput | null | NextResponse> {
  const body = await request.text();
  if (!body.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json(
      { error: "invalid request payload" },
      { status: 400 },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json(
      { error: "invalid request payload" },
      { status: 400 },
    );
  }
  const input = parsed as Record<string, unknown>;
  const recipientPhoneNumber = stringValue(input.recipientPhoneNumber);
  const messageBody = stringValue(input.body);
  const messageKind = stringValue(input.messageKind);
  const idempotencyKey = stringValue(input.idempotencyKey);
  if (
    !recipientPhoneNumber ||
    !messageBody ||
    !messageKind ||
    !idempotencyKey
  ) {
    return NextResponse.json(
      {
        error:
          "recipientPhoneNumber, body, messageKind and idempotencyKey are required",
      },
      { status: 400 },
    );
  }
  return {
    recipientPhoneNumber,
    body: messageBody,
    messageKind,
    idempotencyKey,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function deliveryFailure(error: unknown): {
  message: string;
  retryable: boolean;
} {
  if (error instanceof WhatsAppProviderError) {
    return { message: error.message, retryable: error.retryable };
  }
  return { message: "delivery dispatch failed", retryable: true };
}

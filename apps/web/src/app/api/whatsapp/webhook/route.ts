import { NextResponse } from "next/server";
import {
  normalizeInboundMessages,
  normalizeWhatsAppDeliveryStatuses,
  verifyWebhookSignature,
  verifyWebhookToken,
  type WhatsAppInboundMessage,
} from "@markd/messaging";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const challenge = verifyWebhookToken(
    url.searchParams.get("hub.mode"),
    url.searchParams.get("hub.verify_token"),
    url.searchParams.get("hub.challenge"),
    process.env.WHATSAPP_VERIFY_TOKEN,
  );
  return challenge === null
    ? new NextResponse("Forbidden", { status: 403 })
    : new NextResponse(challenge, { status: 200 });
}

export async function POST(request: Request) {
  const body = await request.text();
  if (
    !verifyWebhookSignature(
      body,
      request.headers.get("x-hub-signature-256"),
      process.env.WHATSAPP_APP_SECRET,
    )
  ) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const webhookPayload = payload as Record<string, unknown>;
  const inboundMessages = normalizeInboundMessages(webhookPayload);
  const deliveryStatuses = normalizeWhatsAppDeliveryStatuses(webhookPayload);
  if (inboundMessages.length === 0 && deliveryStatuses.length === 0) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const client = createSupabaseAdminClient();
  for (const inbound of inboundMessages) {
    const eventId = await persistInboundEvent(client, inbound);
    if (!eventId) {
      return NextResponse.json(
        { error: "event persistence failed" },
        { status: 503 },
      );
    }
  }

  for (const status of deliveryStatuses) {
    const { error: eventError } = await client.from("channel_events").insert({
      channel: "whatsapp",
      event_type: "status",
      occurred_at: status.occurredAt,
      payload: status.rawPayload,
      provider_event_id: status.providerEventId,
      provider_message_id: status.providerEventId,
      media: [],
    });
    if (eventError && eventError.code !== "23505") {
      return NextResponse.json(
        { error: "status evidence persistence failed" },
        { status: 503 },
      );
    }
    const { error: deliveryError } = await client.rpc(
      "record_channel_delivery_status",
      {
        target_provider_message_id: status.providerMessageId,
        reported_state: status.state,
        reported_at: status.occurredAt,
        reported_failure_reason: status.failureReason,
      },
    );
    if (deliveryError) {
      return NextResponse.json(
        { error: "delivery status persistence failed" },
        { status: 503 },
      );
    }
  }

  return NextResponse.json(
    {
      received: true,
      inboundMessages: inboundMessages.length,
      deliveryStatuses: deliveryStatuses.length,
    },
    { status: 200 },
  );
}

async function persistInboundEvent(
  client: ReturnType<typeof createSupabaseAdminClient>,
  inbound: WhatsAppInboundMessage,
): Promise<string | null> {
  const { data: event, error } = await client
    .from("channel_events")
    .insert({
      channel: "whatsapp",
      event_type: "message",
      occurred_at: inbound.occurredAt,
      payload: inbound.rawPayload,
      provider_event_id: inbound.providerEventId,
      provider_message_id: inbound.providerMessageId,
      sender_phone_number: inbound.senderPhoneNumber,
      media: inbound.media,
    })
    .select("id")
    .single();
  if (error && error.code !== "23505") return null;
  const eventId =
    event?.id ??
    (
      await client
        .from("channel_events")
        .select("id")
        .eq("channel", "whatsapp")
        .eq("provider_message_id", inbound.providerMessageId)
        .single()
    ).data?.id;
  if (!eventId) return null;
  if (inbound.media.length === 0) return eventId;

  const { error: mediaError } = await client
    .from("channel_media_assets")
    .upsert(
      inbound.media.map((media) => ({
        channel_event_id: eventId,
        provider_media_id: media.providerMediaId,
        media_type: media.mediaType,
        mime_type: media.mimeType ?? null,
      })),
      {
        onConflict: "channel_event_id,provider_media_id",
        ignoreDuplicates: true,
      },
    );
  return mediaError ? null : eventId;
}

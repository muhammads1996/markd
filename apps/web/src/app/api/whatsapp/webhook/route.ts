import { NextResponse } from "next/server";
import {
  normalizeInboundMessage,
  verifyWebhookSignature,
  verifyWebhookToken,
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
  const inbound = normalizeInboundMessage(payload as Record<string, unknown>);
  if (!inbound) return NextResponse.json({ received: true }, { status: 200 });

  const client = createSupabaseAdminClient();
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
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: "event persistence failed" }, { status: 503 });
  }
  const eventId = event?.id ?? (
    await client
      .from("channel_events")
      .select("id")
      .eq("channel", "whatsapp")
      .eq("provider_message_id", inbound.providerMessageId)
      .single()
  ).data?.id;
  if (!eventId) return NextResponse.json({ error: "event lookup failed" }, { status: 503 });
  if (inbound.media.length > 0) {
    const { error: mediaError } = await client.from("channel_media_assets").upsert(
      inbound.media.map((media) => ({
        channel_event_id: eventId,
        provider_media_id: media.providerMediaId,
        media_type: media.mediaType,
        mime_type: media.mimeType ?? null,
      })),
      { onConflict: "channel_event_id,provider_media_id", ignoreDuplicates: true },
    );
    if (mediaError) return NextResponse.json({ error: "media persistence failed" }, { status: 503 });
  }
  return NextResponse.json(
    {
      received: true,
      providerEventId: inbound.providerEventId,
      providerMessageId: inbound.providerMessageId,
    },
    { status: 200 },
  );
}

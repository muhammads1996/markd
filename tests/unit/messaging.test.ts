import { describe, expect, it } from "vitest";
import {
  buildOutboundDeliveryRow,
  normalizeInboundMessage,
  verifyWebhookSignature,
  verifyWebhookToken,
} from "@markd/messaging";

describe("WhatsApp transport boundary", () => {
  it("verifies the provider webhook challenge", () => {
    expect(
      verifyWebhookToken("subscribe", "secret", "challenge", "secret"),
    ).toBe("challenge");
    expect(
      verifyWebhookToken("subscribe", "wrong", "challenge", "secret"),
    ).toBeNull();
  });

  it("normalizes a text message while preserving the provider payload", () => {
    const payload = {
      id: "provider-event-1",
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "27821234567",
                    id: "wamid-1",
                    timestamp: "1789459200",
                    text: { body: "I am available tomorrow" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const result = normalizeInboundMessage(payload);
    expect(result).toMatchObject({
      providerEventId: "provider-event-1",
      providerMessageId: "wamid-1",
      senderPhoneNumber: "+27821234567",
      text: "I am available tomorrow",
      rawPayload: payload,
    });
  });

  it("captures provider media metadata without retrieving the media inline", () => {
    const result = normalizeInboundMessage({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "27821234567",
                    id: "wamid-2",
                    image: { id: "media-1", mime_type: "image/jpeg" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(result?.media).toEqual([
      {
        providerMediaId: "media-1",
        mediaType: "image",
        mimeType: "image/jpeg",
      },
    ]);
  });

  it("verifies the signed raw provider body", () => {
    const body = '{"entry":[]}';
    expect(verifyWebhookSignature(body, "sha256=bad", "secret")).toBe(false);
  });

  it("builds an idempotent outbound delivery with typed provenance", () => {
    expect(
      buildOutboundDeliveryRow({
        recipientPhoneNumber: "+27821234567",
        body: "WORK CONFIRMED",
        messageKind: "work_confirmed",
        idempotencyKey: "assignment-1-work-confirmed",
        sourceProposedActionId: "73000000-0000-4000-8000-000000000001",
        sourceChannelEventId: "72000000-0000-4000-8000-000000000001",
      }),
    ).toMatchObject({
      channel: "whatsapp",
      state: "queued",
      source_proposed_action_id: "73000000-0000-4000-8000-000000000001",
    });
  });
});

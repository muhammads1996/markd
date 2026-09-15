import { describe, expect, it } from "vitest";
import {
  buildOutboundDeliveryRow,
  MetaWhatsAppCloudProvider,
  normalizeInboundMessage,
  normalizeWhatsAppDeliveryStatuses,
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

  it("normalizes a provider delivery callback without treating read as a new state", () => {
    const statuses = normalizeWhatsAppDeliveryStatuses({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: "wamid-outbound-1",
                    status: "read",
                    timestamp: "1789459200",
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(statuses).toMatchObject([
      {
        providerMessageId: "wamid-outbound-1",
        state: "delivered",
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

  it("uses the Meta API for a text send and authenticated media download", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const provider = new MetaWhatsAppCloudProvider({
      accessToken: "test-token",
      phoneNumberId: "12345",
      apiVersion: "v24.0",
      fetchImplementation: async (input, init) => {
        const url = String(input);
        requests.push({
          url,
          authorization: new Headers(init?.headers).get("authorization"),
        });
        if (url.endsWith("/messages")) {
          return new Response(
            JSON.stringify({ messages: [{ id: "wamid-outbound-1" }] }),
            { status: 200 },
          );
        }
        if (url.includes("graph.facebook.com") && url.endsWith("/media-1")) {
          return new Response(
            JSON.stringify({
              url: "https://lookaside.fbsbx.com/media-1",
              mime_type: "audio/ogg",
              file_size: 3,
            }),
            { status: 200 },
          );
        }
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-length": "3" },
        });
      },
    });

    await expect(
      provider.sendText({ recipientPhoneNumber: "+27821234567", body: "Test" }),
    ).resolves.toEqual({ providerMessageId: "wamid-outbound-1" });
    await expect(provider.getMedia({ providerMediaId: "media-1" })).resolves.toMatchObject({
      mimeType: "audio/ogg",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ authorization: "Bearer test-token" }),
      ]),
    );
  });
});

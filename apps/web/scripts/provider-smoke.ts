import {
  createMarkdOpenRouterProviderConfiguration,
  OpenRouterStructuredIntentProvider,
  OpenRouterTranscriptionProvider,
} from "@markd/language";
import { MetaWhatsAppCloudProvider } from "@markd/messaging";

if (!process.argv.includes("--confirm-live")) {
  throw new Error(
    "Provider smoke testing is disabled. Pass --confirm-live explicitly.",
  );
}

const openRouterConfiguration = createMarkdOpenRouterProviderConfiguration(
  requiredEnvironmentValue("OPENROUTER_API_KEY"),
);
const intentProvider = new OpenRouterStructuredIntentProvider(
  openRouterConfiguration,
);
const intent = await intentProvider.extract({
  text: "Hi, need maybe 4 bricklayers in Khayelitsha tomorrow morning, can you help?",
  languageCode: "en",
});
if (!intent) throw new Error("OpenRouter returned no structured intent.");

if (process.argv.includes("--intent-only")) {
  console.log(
    JSON.stringify({
      intent: {
        actionType: intent.actionType,
        ambiguity: intent.ambiguity,
        model: intent.providerEvidence.model,
        usedFallback: intent.providerEvidence.usedFallback,
      },
    }),
  );
  process.exit(0);
}

const transcriptionProvider = new OpenRouterTranscriptionProvider(
  openRouterConfiguration,
);
const whatsappProvider = new MetaWhatsAppCloudProvider({
  accessToken: requiredEnvironmentValue("WHATSAPP_ACCESS_TOKEN"),
  phoneNumberId: requiredEnvironmentValue("WHATSAPP_PHONE_NUMBER_ID"),
});

const sent = await whatsappProvider.sendText({
  recipientPhoneNumber: requiredArgument("--recipient"),
  body: "MARKD provider smoke test. No response is required.",
});

const media = await whatsappProvider.getMedia({
  providerMediaId: requiredArgument("--voice-media-id"),
});
const transcription = await transcriptionProvider.transcribe({
  mediaBytes: media.bytes,
  mimeType: media.mimeType,
});
if (!transcription)
  throw new Error("OpenRouter returned no voice transcription.");

// Do not print message content, phone numbers, tokens, URLs, or raw provider payloads.
console.log(
  JSON.stringify({
    intent: {
      actionType: intent.actionType,
      ambiguity: intent.ambiguity,
      model: intent.providerEvidence.model,
      usedFallback: intent.providerEvidence.usedFallback,
    },
    outbound: { providerMessageId: sent.providerMessageId },
    transcription: {
      languageCode: transcription.languageCode,
      confidence: transcription.confidence,
      model: transcription.providerEvidence?.model ?? null,
    },
  }),
);

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`${name} is required for provider smoke testing.`);
  return value;
}

function requiredArgument(name: string): string {
  const value = process.argv[process.argv.indexOf(name) + 1]?.trim();
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} is required for provider smoke testing.`);
  }
  return value;
}
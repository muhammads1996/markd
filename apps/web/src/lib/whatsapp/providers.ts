import "server-only";

import {
  createMarkdOpenRouterProviderConfiguration,
  HeuristicLanguageDetectionProvider,
  OpenRouterStructuredIntentProvider,
  OpenRouterTranscriptionProvider,
  UnavailableTranscriptionProvider,
  type LanguageDetectionProvider,
  type StructuredIntentProvider,
  type TranscriptionProvider,
} from "@markd/language";
import {
  MetaWhatsAppCloudProvider,
  type WhatsAppProvider,
} from "@markd/messaging";

export const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";

export type LanguageProcessingProviders = {
  languageDetector: LanguageDetectionProvider;
  structuredIntentProvider: StructuredIntentProvider | null;
  transcriptionProvider: TranscriptionProvider;
  liveProviderEnabled: boolean;
};

export function getWhatsAppProvider(): WhatsAppProvider {
  return new MetaWhatsAppCloudProvider({
    accessToken: requiredEnvironmentValue("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: requiredEnvironmentValue("WHATSAPP_PHONE_NUMBER_ID"),
  });
}

export function getLanguageProcessingProviders(): LanguageProcessingProviders {
  const languageDetector = new HeuristicLanguageDetectionProvider();
  const openRouterApiKey = optionalEnvironmentValue("OPENROUTER_API_KEY");
  if (!openRouterApiKey) {
    return {
      languageDetector,
      structuredIntentProvider: null,
      transcriptionProvider: new UnavailableTranscriptionProvider(),
      liveProviderEnabled: false,
    };
  }

  const configuration =
    createMarkdOpenRouterProviderConfiguration(openRouterApiKey);
  return {
    languageDetector,
    structuredIntentProvider: new OpenRouterStructuredIntentProvider(
      configuration,
    ),
    transcriptionProvider: new OpenRouterTranscriptionProvider(configuration),
    liveProviderEnabled: true,
  };
}

function requiredEnvironmentValue(name: string): string {
  const value = optionalEnvironmentValue(name);
  if (!value)
    throw new Error(`${name} is required for the configured provider.`);
  return value;
}

function optionalEnvironmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

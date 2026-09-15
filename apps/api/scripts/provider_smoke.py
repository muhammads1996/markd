import argparse
import asyncio
import sys

from app.core.config import get_settings
from app.integrations.language import OpenRouterProvider
from app.integrations.whatsapp import MetaWhatsAppCloudProvider


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run an explicit credentialed FastAPI provider smoke check."
    )
    parser.add_argument("--confirm-live", action="store_true")
    parser.add_argument("--recipient", required=True)
    parser.add_argument("--voice-media-id", required=True)
    arguments = sys.argv[1:]
    if arguments[:1] == ["--"]:
        arguments = arguments[1:]
    args = parser.parse_args(arguments)
    if not args.confirm_live:
        parser.error("--confirm-live is required")

    settings = get_settings()
    required = {
        "WHATSAPP_ACCESS_TOKEN": settings.whatsapp_access_token,
        "WHATSAPP_PHONE_NUMBER_ID": settings.whatsapp_phone_number_id,
        "OPENROUTER_API_KEY": settings.openrouter_api_key,
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        parser.error("Missing required provider configuration: " + ", ".join(missing))

    whatsapp = MetaWhatsAppCloudProvider(
        settings.whatsapp_access_token,
        settings.whatsapp_phone_number_id,
        settings.whatsapp_graph_api_version,
        settings.whatsapp_graph_base_url,
        settings.whatsapp_max_media_bytes,
    )
    language = OpenRouterProvider(
        settings.openrouter_api_key,
        settings.openrouter_base_url,
        (settings.openrouter_intent_model, settings.openrouter_intent_fallback_model),
        (
            settings.openrouter_transcription_model,
            settings.openrouter_transcription_fallback_model,
        ),
        settings.openrouter_intent_max_tokens,
        settings.openrouter_transcription_max_tokens,
        settings.openrouter_intent_max_cost_usd,
        settings.openrouter_transcription_max_cost_usd,
    )
    try:
        provider_message_id = await whatsapp.send_text(
            args.recipient, "MARKD FastAPI provider smoke check."
        )
        media = await whatsapp.get_media(args.voice_media_id)
        transcription = await language.transcribe(media.bytes, media.mime_type)
        intent = await language.extract_intent(
            "Need 4 workers tomorrow, please confirm the crew.", "en"
        )
    finally:
        await whatsapp.aclose()
        await language.aclose()

    print(
        {
            "outbound_message_id_received": bool(provider_message_id),
            "media_bytes_retrieved": len(media.bytes),
            "transcription_received": transcription is not None,
            "intent_received": intent is not None,
        }
    )


if __name__ == "__main__":
    asyncio.run(main())
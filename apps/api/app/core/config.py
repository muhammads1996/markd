from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "apps/api/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "markd-api"
    app_version: str = "0.1.0"
    environment: str = "local"
    supabase_url: str = "http://127.0.0.1:54321"
    supabase_db_url: str | None = None
    supabase_service_role_key: str | None = None
    supabase_jwt_secret: str | None = None
    supabase_jwt_audience: str = "authenticated"
    api_database_min_size: int = 1
    api_database_max_size: int = 10
    allowed_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )
    whatsapp_verify_token: str = ""
    whatsapp_app_secret: str = ""
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_graph_api_version: str = "v24.0"
    whatsapp_graph_base_url: str = "https://graph.facebook.com"
    whatsapp_max_media_bytes: int = 12 * 1024 * 1024
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_intent_model: str = "openai/gpt-4.1-mini"
    openrouter_intent_fallback_model: str = "google/gemini-2.5-flash-lite"
    openrouter_transcription_model: str = "google/gemini-2.5-flash"
    openrouter_transcription_fallback_model: str = "google/gemini-2.5-flash-lite"
    openrouter_intent_max_tokens: int = 300
    openrouter_transcription_max_tokens: int = 500
    openrouter_intent_max_cost_usd: float = 0.01
    openrouter_transcription_max_cost_usd: float = 0.03
    # TypeSafe/Jev is backend-only. Keep it off until a controlled shadow run.
    typesafe_api_key: str = ""
    semantic_decision_enabled: bool = False
    semantic_decision_provider: str = "jev"
    semantic_decision_mode: Literal["off", "shadow", "active"] = "off"
    semantic_decision_base_url: str = "https://api.typesafe.ai"
    semantic_decision_model: str = "jev-1.13.0"
    semantic_decision_timeout_seconds: float = Field(default=8, gt=0, le=30)
    semantic_decision_max_retries: int = Field(default=1, ge=0, le=3)
    semantic_decision_active_policy: dict[str, float] = Field(default_factory=dict)
    internal_service_token: str = ""
    internal_service_token_header: str = "X-Internal-Service-Token"
    worker_poll_interval_seconds: float = Field(default=10, gt=0, le=300)

    @field_validator("semantic_decision_active_policy")
    @classmethod
    def validate_semantic_policy_thresholds(
        cls, policy: dict[str, float]
    ) -> dict[str, float]:
        if any(not 0 <= value <= 1 for value in policy.values()):
            raise ValueError(
                "Semantic decision policy thresholds must be between 0 and 1"
            )
        return policy


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

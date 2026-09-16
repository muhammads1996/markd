export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      areas: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          locality: string | null
          name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          locality?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          locality?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      assignment_acknowledgements: {
        Row: {
          actor_user_id: string
          assignment_id: string
          created_at: string
          id: string
          kind: string
        }
        Insert: {
          actor_user_id: string
          assignment_id: string
          created_at?: string
          id?: string
          kind: string
        }
        Update: {
          actor_user_id?: string
          assignment_id?: string
          created_at?: string
          id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_acknowledgements_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_stamps: {
        Row: {
          amount_cents: number | null
          asserted_by_person_id: string | null
          asserted_role: string
          assignment_id: string
          attendance: Database["public"]["Enums"]["attendance_outcome"]
          completion: Database["public"]["Enums"]["completion_outcome"]
          created_at: string
          currency: string | null
          id: string
          note: string | null
          occurred_at: string
          payment: Database["public"]["Enums"]["payment_state"]
          payment_method: string | null
          recorded_by_user_id: string
          reuse_preference: Database["public"]["Enums"]["reuse_preference"]
          source: string
          source_channel_event_id: string | null
          source_proposed_action_id: string | null
          workmark_id: string
        }
        Insert: {
          amount_cents?: number | null
          asserted_by_person_id?: string | null
          asserted_role: string
          assignment_id: string
          attendance?: Database["public"]["Enums"]["attendance_outcome"]
          completion?: Database["public"]["Enums"]["completion_outcome"]
          created_at?: string
          currency?: string | null
          id?: string
          note?: string | null
          occurred_at?: string
          payment?: Database["public"]["Enums"]["payment_state"]
          payment_method?: string | null
          recorded_by_user_id: string
          reuse_preference?: Database["public"]["Enums"]["reuse_preference"]
          source: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          workmark_id: string
        }
        Update: {
          amount_cents?: number | null
          asserted_by_person_id?: string | null
          asserted_role?: string
          assignment_id?: string
          attendance?: Database["public"]["Enums"]["attendance_outcome"]
          completion?: Database["public"]["Enums"]["completion_outcome"]
          created_at?: string
          currency?: string | null
          id?: string
          note?: string | null
          occurred_at?: string
          payment?: Database["public"]["Enums"]["payment_state"]
          payment_method?: string | null
          recorded_by_user_id?: string
          reuse_preference?: Database["public"]["Enums"]["reuse_preference"]
          source?: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          workmark_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_stamps_asserted_by_person_id_fkey"
            columns: ["asserted_by_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_stamps_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_stamps_source_channel_event_id_fkey"
            columns: ["source_channel_event_id"]
            isOneToOne: false
            referencedRelation: "channel_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_stamps_source_proposed_action_id_fkey"
            columns: ["source_proposed_action_id"]
            isOneToOne: false
            referencedRelation: "proposed_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_stamps_workmark_id_fkey"
            columns: ["workmark_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_work"
            referencedColumns: ["workmark_id"]
          },
          {
            foreignKeyName: "assignment_stamps_workmark_id_fkey"
            columns: ["workmark_id"]
            isOneToOne: false
            referencedRelation: "workmarks"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          agreed_rate_cents: number | null
          archived_at: string | null
          cancellation_note: string | null
          cancellation_reason: string | null
          cancelled_after_travel_authorised: boolean
          cancelled_at: string | null
          contact: Json | null
          contractor_confirmation: string
          contractor_confirmed_at: string | null
          created_at: string
          currency: string | null
          ends_on: string
          hirer_person_id: string | null
          id: string
          instructions: string | null
          labour_request_id: string
          labour_requirement_id: string | null
          landmark: string | null
          lifecycle: string
          location_pin: Json | null
          offered_at: string | null
          organisation_id: string | null
          pickup_point_id: string | null
          reporting_at: string | null
          reporting_mode: string | null
          reporting_place_text: string | null
          site_id: string | null
          source: string
          source_channel_event_id: string | null
          source_proposed_action_id: string | null
          starts_on: string
          travel_authorised_at: string | null
          travel_revoked_at: string | null
          updated_at: string
          version: number
          worker_id: string
          worker_responded_at: string | null
          worker_response: string
        }
        Insert: {
          agreed_rate_cents?: number | null
          archived_at?: string | null
          cancellation_note?: string | null
          cancellation_reason?: string | null
          cancelled_after_travel_authorised?: boolean
          cancelled_at?: string | null
          contact?: Json | null
          contractor_confirmation?: string
          contractor_confirmed_at?: string | null
          created_at?: string
          currency?: string | null
          ends_on: string
          hirer_person_id?: string | null
          id?: string
          instructions?: string | null
          labour_request_id: string
          labour_requirement_id?: string | null
          landmark?: string | null
          lifecycle?: string
          location_pin?: Json | null
          offered_at?: string | null
          organisation_id?: string | null
          pickup_point_id?: string | null
          reporting_at?: string | null
          reporting_mode?: string | null
          reporting_place_text?: string | null
          site_id?: string | null
          source?: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          starts_on: string
          travel_authorised_at?: string | null
          travel_revoked_at?: string | null
          updated_at?: string
          version?: number
          worker_id: string
          worker_responded_at?: string | null
          worker_response?: string
        }
        Update: {
          agreed_rate_cents?: number | null
          archived_at?: string | null
          cancellation_note?: string | null
          cancellation_reason?: string | null
          cancelled_after_travel_authorised?: boolean
          cancelled_at?: string | null
          contact?: Json | null
          contractor_confirmation?: string
          contractor_confirmed_at?: string | null
          created_at?: string
          currency?: string | null
          ends_on?: string
          hirer_person_id?: string | null
          id?: string
          instructions?: string | null
          labour_request_id?: string
          labour_requirement_id?: string | null
          landmark?: string | null
          lifecycle?: string
          location_pin?: Json | null
          offered_at?: string | null
          organisation_id?: string | null
          pickup_point_id?: string | null
          reporting_at?: string | null
          reporting_mode?: string | null
          reporting_place_text?: string | null
          site_id?: string | null
          source?: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          starts_on?: string
          travel_authorised_at?: string | null
          travel_revoked_at?: string | null
          updated_at?: string
          version?: number
          worker_id?: string
          worker_responded_at?: string | null
          worker_response?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_hirer_person_id_fkey"
            columns: ["hirer_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_labour_request_id_fkey"
            columns: ["labour_request_id"]
            isOneToOne: false
            referencedRelation: "labour_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_labour_requirement_id_fkey"
            columns: ["labour_requirement_id"]
            isOneToOne: false
            referencedRelation: "labour_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_source_channel_event_id_fkey"
            columns: ["source_channel_event_id"]
            isOneToOne: false
            referencedRelation: "channel_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_source_proposed_action_id_fkey"
            columns: ["source_proposed_action_id"]
            isOneToOne: false
            referencedRelation: "proposed_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "assignments_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "assignments_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "assignments_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "assignments_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "assignments_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_kind: string
          changes: Json
          id: string
          occurred_at: string
          operator_account_id: string | null
          record_id: string
          source_channel_event_id: string | null
          source_proposed_action_id: string | null
          source_verification_claim_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_kind?: string
          changes: Json
          id?: string
          occurred_at?: string
          operator_account_id?: string | null
          record_id: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          source_verification_claim_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_kind?: string
          changes?: Json
          id?: string
          occurred_at?: string
          operator_account_id?: string | null
          record_id?: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          source_verification_claim_id?: string | null
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_operator_account_id_fkey"
            columns: ["operator_account_id"]
            isOneToOne: false
            referencedRelation: "operator_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_events_source_channel_event_id_fkey"
            columns: ["source_channel_event_id"]
            isOneToOne: false
            referencedRelation: "channel_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_source_proposed_action_id_fkey"
            columns: ["source_proposed_action_id"]
            isOneToOne: false
            referencedRelation: "proposed_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_source_verification_claim_id_fkey"
            columns: ["source_verification_claim_id"]
            isOneToOne: false
            referencedRelation: "verification_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_signals: {
        Row: {
          archived_at: string | null
          available_from: string
          available_to: string | null
          created_at: string
          id: string
          source: string
          status: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          archived_at?: string | null
          available_from: string
          available_to?: string | null
          created_at?: string
          id?: string
          source: string
          status: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          archived_at?: string | null
          available_from?: string
          available_to?: string | null
          created_at?: string
          id?: string
          source?: string
          status?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_signals_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "availability_signals_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "availability_signals_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "availability_signals_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "availability_signals_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "availability_signals_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
      channel_deliveries: {
        Row: {
          attempts: number
          available_at: string
          body: string
          channel: string
          created_at: string
          delivered_at: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          leased_until: string | null
          message_kind: string
          provider_message_id: string | null
          recipient_phone_number: string
          sent_at: string | null
          source_channel_event_id: string | null
          source_proposed_action_id: string | null
          source_record_id: string | null
          source_table: string | null
          state: Database["public"]["Enums"]["channel_delivery_state"]
        }
        Insert: {
          attempts?: number
          available_at?: string
          body: string
          channel: string
          created_at?: string
          delivered_at?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          last_error?: string | null
          leased_until?: string | null
          message_kind: string
          provider_message_id?: string | null
          recipient_phone_number: string
          sent_at?: string | null
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          source_record_id?: string | null
          source_table?: string | null
          state?: Database["public"]["Enums"]["channel_delivery_state"]
        }
        Update: {
          attempts?: number
          available_at?: string
          body?: string
          channel?: string
          created_at?: string
          delivered_at?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          last_error?: string | null
          leased_until?: string | null
          message_kind?: string
          provider_message_id?: string | null
          recipient_phone_number?: string
          sent_at?: string | null
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          source_record_id?: string | null
          source_table?: string | null
          state?: Database["public"]["Enums"]["channel_delivery_state"]
        }
        Relationships: [
          {
            foreignKeyName: "channel_deliveries_source_action_fkey"
            columns: ["source_proposed_action_id"]
            isOneToOne: false
            referencedRelation: "proposed_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_deliveries_source_event_fkey"
            columns: ["source_channel_event_id"]
            isOneToOne: false
            referencedRelation: "channel_events"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_events: {
        Row: {
          channel: string
          created_at: string
          detected_language_code: string | null
          detected_language_confidence: number | null
          event_type: string
          failure_reason: string | null
          id: string
          media: Json
          occurred_at: string | null
          payload: Json
          provider_event_id: string
          provider_message_id: string | null
          received_at: string
          sender_phone_number: string | null
          state: Database["public"]["Enums"]["channel_event_state"]
        }
        Insert: {
          channel: string
          created_at?: string
          detected_language_code?: string | null
          detected_language_confidence?: number | null
          event_type?: string
          failure_reason?: string | null
          id?: string
          media?: Json
          occurred_at?: string | null
          payload?: Json
          provider_event_id: string
          provider_message_id?: string | null
          received_at?: string
          sender_phone_number?: string | null
          state?: Database["public"]["Enums"]["channel_event_state"]
        }
        Update: {
          channel?: string
          created_at?: string
          detected_language_code?: string | null
          detected_language_confidence?: number | null
          event_type?: string
          failure_reason?: string | null
          id?: string
          media?: Json
          occurred_at?: string | null
          payload?: Json
          provider_event_id?: string
          provider_message_id?: string | null
          received_at?: string
          sender_phone_number?: string | null
          state?: Database["public"]["Enums"]["channel_event_state"]
        }
        Relationships: []
      }
      channel_media_assets: {
        Row: {
          channel_event_id: string
          created_at: string
          detected_language_code: string | null
          failure_reason: string | null
          id: string
          media_type: string
          mime_type: string | null
          provider_media_id: string
          provider_url: string | null
          retrieval_state: string
          storage_bucket: string | null
          storage_path: string | null
          transcript: string | null
          transcript_confidence: number | null
          transcription_latency_ms: number | null
          transcription_metadata: Json
          transcription_model: string | null
          transcription_provider: string | null
          updated_at: string
        }
        Insert: {
          channel_event_id: string
          created_at?: string
          detected_language_code?: string | null
          failure_reason?: string | null
          id?: string
          media_type: string
          mime_type?: string | null
          provider_media_id: string
          provider_url?: string | null
          retrieval_state?: string
          storage_bucket?: string | null
          storage_path?: string | null
          transcript?: string | null
          transcript_confidence?: number | null
          transcription_latency_ms?: number | null
          transcription_metadata?: Json
          transcription_model?: string | null
          transcription_provider?: string | null
          updated_at?: string
        }
        Update: {
          channel_event_id?: string
          created_at?: string
          detected_language_code?: string | null
          failure_reason?: string | null
          id?: string
          media_type?: string
          mime_type?: string | null
          provider_media_id?: string
          provider_url?: string | null
          retrieval_state?: string
          storage_bucket?: string | null
          storage_path?: string | null
          transcript?: string | null
          transcript_confidence?: number | null
          transcription_latency_ms?: number | null
          transcription_metadata?: Json
          transcription_model?: string | null
          transcription_provider?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_media_assets_channel_event_id_fkey"
            columns: ["channel_event_id"]
            isOneToOne: false
            referencedRelation: "channel_events"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_processing_jobs: {
        Row: {
          attempts: number
          available_at: string
          channel_event_id: string
          created_at: string
          id: string
          last_error: string | null
          leased_until: string | null
          state: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          channel_event_id: string
          created_at?: string
          id?: string
          last_error?: string | null
          leased_until?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          channel_event_id?: string
          created_at?: string
          id?: string
          last_error?: string | null
          leased_until?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_processing_jobs_channel_event_id_fkey"
            columns: ["channel_event_id"]
            isOneToOne: true
            referencedRelation: "channel_events"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_links: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          source: string
          updated_at: string
          worker_a_id: string
          worker_b_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          source: string
          updated_at?: string
          worker_a_id: string
          worker_b_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          source?: string
          updated_at?: string
          worker_a_id?: string
          worker_b_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_links_worker_a_id_fkey"
            columns: ["worker_a_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_a_id_fkey"
            columns: ["worker_a_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_a_id_fkey"
            columns: ["worker_a_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_a_id_fkey"
            columns: ["worker_a_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_a_id_fkey"
            columns: ["worker_a_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_a_id_fkey"
            columns: ["worker_a_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "crew_links_worker_b_id_fkey"
            columns: ["worker_b_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_b_id_fkey"
            columns: ["worker_b_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_b_id_fkey"
            columns: ["worker_b_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_b_id_fkey"
            columns: ["worker_b_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_b_id_fkey"
            columns: ["worker_b_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_b_id_fkey"
            columns: ["worker_b_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
      exception_cases: {
        Row: {
          archived_at: string | null
          assignment_id: string | null
          category: string
          created_at: string
          id: string
          opened_by_person_id: string | null
          source: string
          source_channel_event_id: string | null
          source_proposed_action_id: string | null
          state: Database["public"]["Enums"]["exception_state"]
          updated_at: string
          workmark_id: string | null
        }
        Insert: {
          archived_at?: string | null
          assignment_id?: string | null
          category: string
          created_at?: string
          id?: string
          opened_by_person_id?: string | null
          source: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          state?: Database["public"]["Enums"]["exception_state"]
          updated_at?: string
          workmark_id?: string | null
        }
        Update: {
          archived_at?: string | null
          assignment_id?: string | null
          category?: string
          created_at?: string
          id?: string
          opened_by_person_id?: string | null
          source?: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          state?: Database["public"]["Enums"]["exception_state"]
          updated_at?: string
          workmark_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exception_cases_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exception_cases_opened_by_person_id_fkey"
            columns: ["opened_by_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exception_cases_source_channel_event_id_fkey"
            columns: ["source_channel_event_id"]
            isOneToOne: false
            referencedRelation: "channel_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exception_cases_source_proposed_action_id_fkey"
            columns: ["source_proposed_action_id"]
            isOneToOne: false
            referencedRelation: "proposed_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exception_cases_workmark_id_fkey"
            columns: ["workmark_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_work"
            referencedColumns: ["workmark_id"]
          },
          {
            foreignKeyName: "exception_cases_workmark_id_fkey"
            columns: ["workmark_id"]
            isOneToOne: false
            referencedRelation: "workmarks"
            referencedColumns: ["id"]
          },
        ]
      }
      labour_requests: {
        Row: {
          archived_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          created_at: string
          currency: string | null
          headcount: number
          id: string
          lifecycle: string
          needed_at: string | null
          needed_from: string
          needed_to: string
          notes: string | null
          organisation_id: string | null
          rate_basis: string
          rate_cents: number | null
          requested_by_contact_id: string | null
          requester_person_id: string | null
          site_area: string
          site_id: string | null
          site_text: string | null
          source: string
          source_channel_event_id: string | null
          source_proposed_action_id: string | null
          terms: string | null
          timezone: string
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          currency?: string | null
          headcount: number
          id?: string
          lifecycle?: string
          needed_at?: string | null
          needed_from: string
          needed_to: string
          notes?: string | null
          organisation_id?: string | null
          rate_basis?: string
          rate_cents?: number | null
          requested_by_contact_id?: string | null
          requester_person_id?: string | null
          site_area?: string
          site_id?: string | null
          site_text?: string | null
          source?: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          terms?: string | null
          timezone?: string
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          currency?: string | null
          headcount?: number
          id?: string
          lifecycle?: string
          needed_at?: string | null
          needed_from?: string
          needed_to?: string
          notes?: string | null
          organisation_id?: string | null
          rate_basis?: string
          rate_cents?: number | null
          requested_by_contact_id?: string | null
          requester_person_id?: string | null
          site_area?: string
          site_id?: string | null
          site_text?: string | null
          source?: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          terms?: string | null
          timezone?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "labour_requests_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_requests_requested_by_contact_id_fkey"
            columns: ["requested_by_contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_requests_requester_person_id_fkey"
            columns: ["requester_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_requests_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_requests_source_channel_event_id_fkey"
            columns: ["source_channel_event_id"]
            isOneToOne: false
            referencedRelation: "channel_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_requests_source_proposed_action_id_fkey"
            columns: ["source_proposed_action_id"]
            isOneToOne: false
            referencedRelation: "proposed_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      labour_requirements: {
        Row: {
          archived_at: string | null
          created_at: string
          headcount: number
          id: string
          labour_request_id: string
          notes: string | null
          skill_id: string | null
          updated_at: string
          version: number
          work_type: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          headcount: number
          id?: string
          labour_request_id: string
          notes?: string | null
          skill_id?: string | null
          updated_at?: string
          version?: number
          work_type: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          headcount?: number
          id?: string
          labour_request_id?: string
          notes?: string | null
          skill_id?: string | null
          updated_at?: string
          version?: number
          work_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "labour_requirements_labour_request_id_fkey"
            columns: ["labour_request_id"]
            isOneToOne: false
            referencedRelation: "labour_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labour_requirements_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "labour_requirements_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      languages: {
        Row: {
          archived_at: string | null
          code: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          code?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      operator_accounts: {
        Row: {
          archived_at: string | null
          created_at: string
          person_id: string | null
          role: Database["public"]["Enums"]["operator_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          person_id?: string | null
          role: Database["public"]["Enums"]["operator_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          person_id?: string | null
          role?: Database["public"]["Enums"]["operator_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_accounts_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_contacts: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          is_primary: boolean
          organisation_id: string
          person_id: string
          role_name: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          organisation_id: string
          person_id: string
          role_name?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          organisation_id?: string
          person_id?: string
          role_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_contacts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_contacts_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_operating_areas: {
        Row: {
          archived_at: string | null
          area_id: string
          created_at: string
          organisation_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          area_id: string
          created_at?: string
          organisation_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          area_id?: string
          created_at?: string
          organisation_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_operating_areas_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_operating_areas_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_typical_skills: {
        Row: {
          archived_at: string | null
          created_at: string
          organisation_id: string
          skill_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          organisation_id: string
          skill_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          organisation_id?: string
          skill_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_typical_skills_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisation_typical_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "organisation_typical_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations: {
        Row: {
          archived_at: string | null
          created_at: string
          display_name: string
          id: string
          legal_name: string
          record_status: Database["public"]["Enums"]["record_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          display_name: string
          id?: string
          legal_name: string
          record_status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          display_name?: string
          id?: string
          legal_name?: string
          record_status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Relationships: []
      }
      participant_account_scopes: {
        Row: {
          auth_user_id: string
          created_at: string
          id: string
          organisation_contact_id: string | null
          scope_kind: Database["public"]["Enums"]["participant_scope_kind"]
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          id?: string
          organisation_contact_id?: string | null
          scope_kind: Database["public"]["Enums"]["participant_scope_kind"]
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          id?: string
          organisation_contact_id?: string | null
          scope_kind?: Database["public"]["Enums"]["participant_scope_kind"]
        }
        Relationships: [
          {
            foreignKeyName: "participant_account_scopes_auth_user_id_fkey"
            columns: ["auth_user_id"]
            isOneToOne: false
            referencedRelation: "participant_accounts"
            referencedColumns: ["auth_user_id"]
          },
          {
            foreignKeyName: "participant_account_scopes_organisation_contact_id_fkey"
            columns: ["organisation_contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_accounts: {
        Row: {
          auth_user_id: string
          created_at: string
          person_id: string
          status: Database["public"]["Enums"]["participant_account_status"]
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          person_id: string
          status?: Database["public"]["Enums"]["participant_account_status"]
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          person_id?: string
          status?: Database["public"]["Enums"]["participant_account_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "participant_accounts_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          archived_at: string | null
          created_at: string
          display_name: string
          family_name: string | null
          given_name: string | null
          id: string
          preferred_communication_mode: string
          preferred_language_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          display_name: string
          family_name?: string | null
          given_name?: string | null
          id?: string
          preferred_communication_mode?: string
          preferred_language_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          display_name?: string
          family_name?: string | null
          given_name?: string | null
          id?: string
          preferred_communication_mode?: string
          preferred_language_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_preferred_language_id_fkey"
            columns: ["preferred_language_id"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["id"]
          },
        ]
      }
      person_languages: {
        Row: {
          archived_at: string | null
          created_at: string
          language_id: string
          person_id: string
          proficiency: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          language_id: string
          person_id: string
          proficiency?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          language_id?: string
          person_id?: string
          proficiency?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_languages_language_id_fkey"
            columns: ["language_id"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_languages_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      person_phone_numbers: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          is_primary: boolean
          person_id: string
          phone_number: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          person_id: string
          phone_number: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          person_id?: string
          phone_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_phone_numbers_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      person_private_details: {
        Row: {
          archived_at: string | null
          created_at: string
          notes: string | null
          person_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          notes?: string | null
          person_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          notes?: string | null
          person_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_private_details_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      proposed_actions: {
        Row: {
          action_type: string
          ambiguity: Database["public"]["Enums"]["proposed_action_ambiguity_state"]
          archived_at: string | null
          channel_event_id: string
          confidence: number | null
          confirmed_at: string | null
          confirmed_by_operator_id: string | null
          created_at: string
          entity_resolution: Json
          id: string
          interpretation: Json
          model_name: string | null
          model_provider: string | null
          payload: Json
          rejection_reason: string | null
          risk_tier: Database["public"]["Enums"]["proposed_action_risk_tier"]
          state: Database["public"]["Enums"]["proposed_action_state"]
          updated_at: string
        }
        Insert: {
          action_type: string
          ambiguity?: Database["public"]["Enums"]["proposed_action_ambiguity_state"]
          archived_at?: string | null
          channel_event_id: string
          confidence?: number | null
          confirmed_at?: string | null
          confirmed_by_operator_id?: string | null
          created_at?: string
          entity_resolution?: Json
          id?: string
          interpretation?: Json
          model_name?: string | null
          model_provider?: string | null
          payload?: Json
          rejection_reason?: string | null
          risk_tier: Database["public"]["Enums"]["proposed_action_risk_tier"]
          state?: Database["public"]["Enums"]["proposed_action_state"]
          updated_at?: string
        }
        Update: {
          action_type?: string
          ambiguity?: Database["public"]["Enums"]["proposed_action_ambiguity_state"]
          archived_at?: string | null
          channel_event_id?: string
          confidence?: number | null
          confirmed_at?: string | null
          confirmed_by_operator_id?: string | null
          created_at?: string
          entity_resolution?: Json
          id?: string
          interpretation?: Json
          model_name?: string | null
          model_provider?: string | null
          payload?: Json
          rejection_reason?: string | null
          risk_tier?: Database["public"]["Enums"]["proposed_action_risk_tier"]
          state?: Database["public"]["Enums"]["proposed_action_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposed_actions_channel_event_id_fkey"
            columns: ["channel_event_id"]
            isOneToOne: false
            referencedRelation: "channel_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposed_actions_confirmed_by_operator_id_fkey"
            columns: ["confirmed_by_operator_id"]
            isOneToOne: false
            referencedRelation: "operator_accounts"
            referencedColumns: ["user_id"]
          },
        ]
      }
      sites: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          locality: string | null
          name: string
          organisation_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          locality?: string | null
          name: string
          organisation_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          locality?: string | null
          name?: string
          organisation_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      verification_claims: {
        Row: {
          claimant_person_id: string | null
          created_at: string
          id: string
          organisation_id: string | null
          skill_id: string | null
          source: string
          source_channel_event_id: string | null
          source_proposed_action_id: string | null
          source_reference: string | null
          stance: Database["public"]["Enums"]["claim_stance"]
          supersedes_claim_id: string | null
          value: Json
          worker_id: string | null
          workmark_id: string | null
        }
        Insert: {
          claimant_person_id?: string | null
          created_at?: string
          id?: string
          organisation_id?: string | null
          skill_id?: string | null
          source: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          source_reference?: string | null
          stance: Database["public"]["Enums"]["claim_stance"]
          supersedes_claim_id?: string | null
          value: Json
          worker_id?: string | null
          workmark_id?: string | null
        }
        Update: {
          claimant_person_id?: string | null
          created_at?: string
          id?: string
          organisation_id?: string | null
          skill_id?: string | null
          source?: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          source_reference?: string | null
          stance?: Database["public"]["Enums"]["claim_stance"]
          supersedes_claim_id?: string | null
          value?: Json
          worker_id?: string | null
          workmark_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_claims_claimant_person_id_fkey"
            columns: ["claimant_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_claims_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_claims_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "verification_claims_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_claims_source_channel_event_id_fkey"
            columns: ["source_channel_event_id"]
            isOneToOne: false
            referencedRelation: "channel_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_claims_source_proposed_action_id_fkey"
            columns: ["source_proposed_action_id"]
            isOneToOne: false
            referencedRelation: "proposed_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_claims_supersedes_claim_id_fkey"
            columns: ["supersedes_claim_id"]
            isOneToOne: false
            referencedRelation: "verification_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_claims_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "verification_claims_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "verification_claims_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "verification_claims_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "verification_claims_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "verification_claims_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "verification_claims_workmark_id_fkey"
            columns: ["workmark_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_work"
            referencedColumns: ["workmark_id"]
          },
          {
            foreignKeyName: "verification_claims_workmark_id_fkey"
            columns: ["workmark_id"]
            isOneToOne: false
            referencedRelation: "workmarks"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_area_preferences: {
        Row: {
          archived_at: string | null
          area_id: string
          created_at: string
          is_familiar: boolean
          updated_at: string
          willing_to_travel: boolean
          worker_id: string
        }
        Insert: {
          archived_at?: string | null
          area_id: string
          created_at?: string
          is_familiar?: boolean
          updated_at?: string
          willing_to_travel?: boolean
          worker_id: string
        }
        Update: {
          archived_at?: string | null
          area_id?: string
          created_at?: string
          is_familiar?: boolean
          updated_at?: string
          willing_to_travel?: boolean
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_area_preferences_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_area_preferences_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_area_preferences_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_area_preferences_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_area_preferences_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_area_preferences_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_area_preferences_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
      worker_media_assets: {
        Row: {
          archived_at: string | null
          bucket_id: string
          created_at: string
          id: string
          media_kind: string
          object_path: string
          worker_id: string
        }
        Insert: {
          archived_at?: string | null
          bucket_id: string
          created_at?: string
          id?: string
          media_kind: string
          object_path: string
          worker_id: string
        }
        Update: {
          archived_at?: string | null
          bucket_id?: string
          created_at?: string
          id?: string
          media_kind?: string
          object_path?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_media_assets_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_media_assets_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_media_assets_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_media_assets_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_media_assets_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_media_assets_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
      worker_participation_preferences: {
        Row: {
          app_participation: string
          created_at: string
          read_aloud_enabled: boolean
          updated_at: string
          worker_id: string
        }
        Insert: {
          app_participation?: string
          created_at?: string
          read_aloud_enabled?: boolean
          updated_at?: string
          worker_id: string
        }
        Update: {
          app_participation?: string
          created_at?: string
          read_aloud_enabled?: boolean
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_participation_preferences_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_participation_preferences_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_participation_preferences_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_participation_preferences_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_participation_preferences_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_participation_preferences_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
      worker_primary_skills: {
        Row: {
          archived_at: string | null
          created_at: string
          skill_id: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          skill_id: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          skill_id?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_primary_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "worker_primary_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_primary_skills_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_primary_skills_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_primary_skills_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_primary_skills_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_primary_skills_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_primary_skills_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
      worker_private_details: {
        Row: {
          archived_at: string | null
          birth_date: string | null
          created_at: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          archived_at?: string | null
          birth_date?: string | null
          created_at?: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          archived_at?: string | null
          birth_date?: string | null
          created_at?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_private_details_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_private_details_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_private_details_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_private_details_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_private_details_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_private_details_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
      worker_profiles: {
        Row: {
          archived_at: string | null
          base_area_id: string | null
          created_at: string
          created_by_operator_id: string | null
          person_id: string
          preferred_name: string | null
          record_status: Database["public"]["Enums"]["record_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          base_area_id?: string | null
          created_at?: string
          created_by_operator_id?: string | null
          person_id: string
          preferred_name?: string | null
          record_status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          base_area_id?: string | null
          created_at?: string
          created_by_operator_id?: string | null
          person_id?: string
          preferred_name?: string | null
          record_status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_profiles_base_area_id_fkey"
            columns: ["base_area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_profiles_created_by_operator_id_fkey"
            columns: ["created_by_operator_id"]
            isOneToOne: false
            referencedRelation: "operator_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "worker_profiles_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_skill_evidence: {
        Row: {
          archived_at: string | null
          confidence: number | null
          created_at: string
          id: string
          notes: string | null
          skill_id: string
          source: string
          source_channel_event_id: string | null
          source_proposed_action_id: string | null
          worker_id: string
        }
        Insert: {
          archived_at?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          skill_id: string
          source: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          worker_id: string
        }
        Update: {
          archived_at?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          skill_id?: string
          source?: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_skill_evidence_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "worker_skill_evidence_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_skill_evidence_source_channel_event_id_fkey"
            columns: ["source_channel_event_id"]
            isOneToOne: false
            referencedRelation: "channel_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_skill_evidence_source_proposed_action_id_fkey"
            columns: ["source_proposed_action_id"]
            isOneToOne: false
            referencedRelation: "proposed_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_skill_evidence_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_skill_evidence_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_skill_evidence_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_skill_evidence_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_skill_evidence_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "worker_skill_evidence_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
      workmark_corrections: {
        Row: {
          asserted_by_person_id: string | null
          changes: Json
          created_at: string
          id: string
          occurred_at: string
          reason: string
          recorded_by_user_id: string
          source: string
          source_channel_event_id: string | null
          source_proposed_action_id: string | null
          workmark_id: string
        }
        Insert: {
          asserted_by_person_id?: string | null
          changes: Json
          created_at?: string
          id?: string
          occurred_at?: string
          reason: string
          recorded_by_user_id: string
          source: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          workmark_id: string
        }
        Update: {
          asserted_by_person_id?: string | null
          changes?: Json
          created_at?: string
          id?: string
          occurred_at?: string
          reason?: string
          recorded_by_user_id?: string
          source?: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          workmark_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workmark_corrections_asserted_by_person_id_fkey"
            columns: ["asserted_by_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmark_corrections_source_channel_event_id_fkey"
            columns: ["source_channel_event_id"]
            isOneToOne: false
            referencedRelation: "channel_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmark_corrections_source_proposed_action_id_fkey"
            columns: ["source_proposed_action_id"]
            isOneToOne: false
            referencedRelation: "proposed_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmark_corrections_workmark_id_fkey"
            columns: ["workmark_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_work"
            referencedColumns: ["workmark_id"]
          },
          {
            foreignKeyName: "workmark_corrections_workmark_id_fkey"
            columns: ["workmark_id"]
            isOneToOne: false
            referencedRelation: "workmarks"
            referencedColumns: ["id"]
          },
        ]
      }
      workmark_skills: {
        Row: {
          created_at: string
          skill_id: string
          workmark_id: string
        }
        Insert: {
          created_at?: string
          skill_id: string
          workmark_id: string
        }
        Update: {
          created_at?: string
          skill_id?: string
          workmark_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workmark_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "workmark_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmark_skills_workmark_id_fkey"
            columns: ["workmark_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_work"
            referencedColumns: ["workmark_id"]
          },
          {
            foreignKeyName: "workmark_skills_workmark_id_fkey"
            columns: ["workmark_id"]
            isOneToOne: false
            referencedRelation: "workmarks"
            referencedColumns: ["id"]
          },
        ]
      }
      workmarks: {
        Row: {
          amount_cents: number | null
          archived_at: string | null
          assignment_id: string | null
          attendance: Database["public"]["Enums"]["attendance_outcome"]
          completion: Database["public"]["Enums"]["completion_outcome"]
          created_at: string
          currency: string | null
          evidence_state: Database["public"]["Enums"]["workmark_evidence_state"]
          hirer_person_id: string | null
          id: string
          lifecycle: Database["public"]["Enums"]["workmark_lifecycle"]
          organisation_contact_id: string | null
          organisation_id: string | null
          organisation_reuse_preference: Database["public"]["Enums"]["reuse_preference"]
          origin: Database["public"]["Enums"]["workmark_origin"]
          payment: Database["public"]["Enums"]["payment_state"]
          payment_method: string | null
          site_id: string | null
          source: string
          source_channel_event_id: string | null
          source_proposed_action_id: string | null
          source_reference: string | null
          source_verification_claim_id: string | null
          updated_at: string
          version: number
          work_ended_on: string
          work_started_on: string
          worker_id: string
          worker_reuse_preference: Database["public"]["Enums"]["reuse_preference"]
        }
        Insert: {
          amount_cents?: number | null
          archived_at?: string | null
          assignment_id?: string | null
          attendance?: Database["public"]["Enums"]["attendance_outcome"]
          completion?: Database["public"]["Enums"]["completion_outcome"]
          created_at?: string
          currency?: string | null
          evidence_state?: Database["public"]["Enums"]["workmark_evidence_state"]
          hirer_person_id?: string | null
          id?: string
          lifecycle?: Database["public"]["Enums"]["workmark_lifecycle"]
          organisation_contact_id?: string | null
          organisation_id?: string | null
          organisation_reuse_preference?: Database["public"]["Enums"]["reuse_preference"]
          origin: Database["public"]["Enums"]["workmark_origin"]
          payment?: Database["public"]["Enums"]["payment_state"]
          payment_method?: string | null
          site_id?: string | null
          source: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          source_reference?: string | null
          source_verification_claim_id?: string | null
          updated_at?: string
          version?: number
          work_ended_on: string
          work_started_on: string
          worker_id: string
          worker_reuse_preference?: Database["public"]["Enums"]["reuse_preference"]
        }
        Update: {
          amount_cents?: number | null
          archived_at?: string | null
          assignment_id?: string | null
          attendance?: Database["public"]["Enums"]["attendance_outcome"]
          completion?: Database["public"]["Enums"]["completion_outcome"]
          created_at?: string
          currency?: string | null
          evidence_state?: Database["public"]["Enums"]["workmark_evidence_state"]
          hirer_person_id?: string | null
          id?: string
          lifecycle?: Database["public"]["Enums"]["workmark_lifecycle"]
          organisation_contact_id?: string | null
          organisation_id?: string | null
          organisation_reuse_preference?: Database["public"]["Enums"]["reuse_preference"]
          origin?: Database["public"]["Enums"]["workmark_origin"]
          payment?: Database["public"]["Enums"]["payment_state"]
          payment_method?: string | null
          site_id?: string | null
          source?: string
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          source_reference?: string | null
          source_verification_claim_id?: string | null
          updated_at?: string
          version?: number
          work_ended_on?: string
          work_started_on?: string
          worker_id?: string
          worker_reuse_preference?: Database["public"]["Enums"]["reuse_preference"]
        }
        Relationships: [
          {
            foreignKeyName: "workmarks_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmarks_hirer_person_id_fkey"
            columns: ["hirer_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmarks_organisation_contact_id_fkey"
            columns: ["organisation_contact_id"]
            isOneToOne: false
            referencedRelation: "organisation_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmarks_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmarks_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmarks_source_channel_event_id_fkey"
            columns: ["source_channel_event_id"]
            isOneToOne: false
            referencedRelation: "channel_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmarks_source_proposed_action_id_fkey"
            columns: ["source_proposed_action_id"]
            isOneToOne: false
            referencedRelation: "proposed_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmarks_source_verification_claim_id_fkey"
            columns: ["source_verification_claim_id"]
            isOneToOne: false
            referencedRelation: "verification_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
    }
    Views: {
      operator_work_cards: {
        Row: {
          confirmed_workmark_count: number | null
          display_name: string | null
          last_confirmed_worked_on: string | null
          portrait_object_path: string | null
          preferred_name: string | null
          worker_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_profiles_person_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_candidate_summary: {
        Row: {
          confirmed_workmark_count: number | null
          display_name: string | null
          last_confirmed_worked_on: string | null
          preferred_name: string | null
          skill_id: string | null
          skill_name: string | null
          worker_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_profiles_person_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_contractor_labour_book: {
        Row: {
          confirmed_workmark_count: number | null
          first_worked_on: string | null
          is_repeat_relationship: boolean | null
          last_worked_on: string | null
          organisation_id: string | null
          worker_id: string | null
          worker_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workmarks_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
      participant_worker_card: {
        Row: {
          base_area_name: string | null
          confirmed_workmark_count: number | null
          display_name: string | null
          last_confirmed_worked_on: string | null
          preferred_name: string | null
          worker_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_profiles_person_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_worker_home: {
        Row: {
          app_participation: string | null
          base_area_locality: string | null
          base_area_name: string | null
          display_name: string | null
          preferred_communication_mode: string | null
          preferred_language_code: string | null
          preferred_name: string | null
          read_aloud_enabled: boolean | null
          worker_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_profiles_person_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_worker_profile_preferences: {
        Row: {
          app_participation: string | null
          availability_status: string | null
          available_from: string | null
          available_to: string | null
          familiar_area_ids: string[] | null
          preferred_communication_mode: string | null
          preferred_language_code: string | null
          read_aloud_enabled: boolean | null
          willing_to_travel_area_ids: string[] | null
          worker_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_profiles_person_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_worker_work: {
        Row: {
          is_markd_arranged: boolean | null
          organisation_id: string | null
          organisation_name: string | null
          origin: Database["public"]["Enums"]["workmark_origin"] | null
          site_id: string | null
          site_locality: string | null
          site_name: string | null
          work_ended_on: string | null
          work_started_on: string | null
          worker_id: string | null
          workmark_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workmarks_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmarks_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
      worker_crew_relationships: {
        Row: {
          created_at: string | null
          worker_a_id: string | null
          worker_b_id: string | null
        }
        Insert: {
          created_at?: string | null
          worker_a_id?: string | null
          worker_b_id?: string | null
        }
        Update: {
          created_at?: string | null
          worker_a_id?: string | null
          worker_b_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crew_links_worker_a_id_fkey"
            columns: ["worker_a_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_a_id_fkey"
            columns: ["worker_a_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_a_id_fkey"
            columns: ["worker_a_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_a_id_fkey"
            columns: ["worker_a_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_a_id_fkey"
            columns: ["worker_a_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_a_id_fkey"
            columns: ["worker_a_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "crew_links_worker_b_id_fkey"
            columns: ["worker_b_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_b_id_fkey"
            columns: ["worker_b_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_b_id_fkey"
            columns: ["worker_b_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_b_id_fkey"
            columns: ["worker_b_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_b_id_fkey"
            columns: ["worker_b_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "crew_links_worker_b_id_fkey"
            columns: ["worker_b_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
      worker_organisation_relationships: {
        Row: {
          confirmed_workmark_count: number | null
          first_worked_on: string | null
          is_repeat_relationship: boolean | null
          last_worked_on: string | null
          latest_organisation_reuse_preference:
            | Database["public"]["Enums"]["reuse_preference"]
            | null
          latest_worker_reuse_preference:
            | Database["public"]["Enums"]["reuse_preference"]
            | null
          markd_arranged_workmark_count: number | null
          organisation_id: string | null
          worker_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workmarks_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
      worker_organisation_skill_summary: {
        Row: {
          confirmed_workmark_count: number | null
          last_demonstrated_on: string | null
          organisation_id: string | null
          skill_id: string | null
          worker_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workmark_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["skill_id"]
          },
          {
            foreignKeyName: "workmark_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmarks_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "operator_work_cards"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_candidate_summary"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_card"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_home"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "participant_worker_profile_preferences"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "workmarks_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
    }
    Functions: {
      approve_proposed_action: {
        Args: {
          action_id: string
          edited_payload?: Json
          resolve_ambiguity?: boolean
        }
        Returns: {
          action_type: string
          ambiguity: Database["public"]["Enums"]["proposed_action_ambiguity_state"]
          archived_at: string | null
          channel_event_id: string
          confidence: number | null
          confirmed_at: string | null
          confirmed_by_operator_id: string | null
          created_at: string
          entity_resolution: Json
          id: string
          interpretation: Json
          model_name: string | null
          model_provider: string | null
          payload: Json
          rejection_reason: string | null
          risk_tier: Database["public"]["Enums"]["proposed_action_risk_tier"]
          state: Database["public"]["Enums"]["proposed_action_state"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposed_actions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      authorize_channel_media_read: {
        Args: { requested_asset_id: string; requested_expires_in: number }
        Returns: {
          bucket_id: string
          object_path: string
        }[]
      }
      authorize_worker_media_read: {
        Args: { requested_asset_id: string; requested_expires_in: number }
        Returns: {
          bucket_id: string
          object_path: string
        }[]
      }
      begin_worker_onboarding: {
        Args: { payload: Json; requested_worker_id: string }
        Returns: {
          bucket_id: string
          object_path: string
          portrait_asset_id: string
          worker_id: string
        }[]
      }
      cancel_worker_onboarding: { Args: { worker_id: string }; Returns: string }
      claim_channel_deliveries: {
        Args: { batch_size?: number }
        Returns: {
          attempts: number
          available_at: string
          body: string
          channel: string
          created_at: string
          delivered_at: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          leased_until: string | null
          message_kind: string
          provider_message_id: string | null
          recipient_phone_number: string
          sent_at: string | null
          source_channel_event_id: string | null
          source_proposed_action_id: string | null
          source_record_id: string | null
          source_table: string | null
          state: Database["public"]["Enums"]["channel_delivery_state"]
        }[]
        SetofOptions: {
          from: "*"
          to: "channel_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_channel_processing_jobs: {
        Args: { batch_size?: number }
        Returns: {
          attempts: number
          available_at: string
          channel_event_id: string
          created_at: string
          id: string
          last_error: string | null
          leased_until: string | null
          state: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "channel_processing_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_channel_delivery: {
        Args: {
          delivery_id: string
          error_message?: string
          reported_provider_message_id?: string
          retryable?: boolean
          succeeded: boolean
        }
        Returns: {
          attempts: number
          available_at: string
          body: string
          channel: string
          created_at: string
          delivered_at: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          leased_until: string | null
          message_kind: string
          provider_message_id: string | null
          recipient_phone_number: string
          sent_at: string | null
          source_channel_event_id: string | null
          source_proposed_action_id: string | null
          source_record_id: string | null
          source_table: string | null
          state: Database["public"]["Enums"]["channel_delivery_state"]
        }
        SetofOptions: {
          from: "*"
          to: "channel_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_channel_processing_job: {
        Args: {
          error_message?: string
          job_id: string
          retryable?: boolean
          succeeded: boolean
        }
        Returns: {
          attempts: number
          available_at: string
          channel_event_id: string
          created_at: string
          id: string
          last_error: string | null
          leased_until: string | null
          state: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "channel_processing_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_worker_onboarding: {
        Args: {
          object_path: string
          portrait_asset_id: string
          target_status: string
          worker_id: string
        }
        Returns: string
      }
      current_operator_role: {
        Args: never
        Returns: Database["public"]["Enums"]["operator_role"]
      }
      is_active_operator: { Args: never; Returns: boolean }
      is_ops_admin: { Args: never; Returns: boolean }
      onboard_organisation: {
        Args: {
          contact_display_name: string
          contact_phone_number?: string
          contact_role_name?: string
          display_name: string
          legal_name: string
          operating_area_ids?: string[]
          record_status?: string
          typical_skill_ids?: string[]
        }
        Returns: string
      }
      record_channel_delivery_status: {
        Args: {
          reported_at?: string
          reported_failure_reason?: string
          reported_state: Database["public"]["Enums"]["channel_delivery_state"]
          target_provider_message_id: string
        }
        Returns: {
          attempts: number
          available_at: string
          body: string
          channel: string
          created_at: string
          delivered_at: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          leased_until: string | null
          message_kind: string
          provider_message_id: string | null
          recipient_phone_number: string
          sent_at: string | null
          source_channel_event_id: string | null
          source_proposed_action_id: string | null
          source_record_id: string | null
          source_table: string | null
          state: Database["public"]["Enums"]["channel_delivery_state"]
        }
        SetofOptions: {
          from: "*"
          to: "channel_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reject_proposed_action: {
        Args: { action_id: string; reason: string }
        Returns: {
          action_type: string
          ambiguity: Database["public"]["Enums"]["proposed_action_ambiguity_state"]
          archived_at: string | null
          channel_event_id: string
          confidence: number | null
          confirmed_at: string | null
          confirmed_by_operator_id: string | null
          created_at: string
          entity_resolution: Json
          id: string
          interpretation: Json
          model_name: string | null
          model_provider: string | null
          payload: Json
          rejection_reason: string | null
          risk_tier: Database["public"]["Enums"]["proposed_action_risk_tier"]
          state: Database["public"]["Enums"]["proposed_action_state"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "proposed_actions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      requeue_expired_channel_deliveries: { Args: never; Returns: number }
      requeue_expired_channel_processing_jobs: { Args: never; Returns: number }
      search_work_graph: {
        Args: { max_results?: number; search_term: string }
        Returns: {
          detail: string
          result_id: string
          result_kind: string
          title: string
        }[]
      }
      update_organisation_record: {
        Args: { organisation_id: string; payload: Json }
        Returns: string
      }
      update_worker_record: {
        Args: { payload: Json; worker_id: string }
        Returns: string
      }
    }
    Enums: {
      attendance_outcome: "unknown" | "attended" | "no_show" | "partial"
      channel_delivery_state:
        | "queued"
        | "leased"
        | "sent"
        | "delivered"
        | "failed"
      channel_event_state:
        | "received"
        | "queued"
        | "processing"
        | "processed"
        | "failed"
      claim_stance:
        | "asserted"
        | "confirmed"
        | "disputed"
        | "corrected"
        | "withdrawn"
      completion_outcome:
        | "unknown"
        | "completed"
        | "incomplete"
        | "disputed"
        | "partial"
        | "not_completed"
      exception_state: "open" | "investigating" | "resolved" | "dismissed"
      operator_role: "ops_admin" | "ops_user"
      participant_account_status: "active" | "disabled"
      participant_scope_kind: "worker" | "contractor"
      payment_state:
        | "unknown"
        | "unpaid"
        | "paid"
        | "disputed"
        | "pending"
        | "partial"
      proposed_action_ambiguity_state: "clear" | "ambiguous" | "unresolved"
      proposed_action_risk_tier:
        | "informational"
        | "operational"
        | "trust"
        | "economic"
      proposed_action_state:
        | "pending"
        | "approved"
        | "rejected"
        | "executed"
        | "expired"
      record_status: "draft" | "active" | "inactive"
      reuse_preference: "unknown" | "would_reuse" | "would_not_reuse"
      workmark_evidence_state:
        | "pending"
        | "corroborated"
        | "conflicted"
        | "operator_resolved"
      workmark_lifecycle: "draft" | "confirmed" | "corrected" | "voided"
      workmark_origin:
        | "operator_recorded"
        | "historical_claim"
        | "channel_event"
        | "assignment_closeout"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      attendance_outcome: ["unknown", "attended", "no_show", "partial"],
      channel_delivery_state: [
        "queued",
        "leased",
        "sent",
        "delivered",
        "failed",
      ],
      channel_event_state: [
        "received",
        "queued",
        "processing",
        "processed",
        "failed",
      ],
      claim_stance: [
        "asserted",
        "confirmed",
        "disputed",
        "corrected",
        "withdrawn",
      ],
      completion_outcome: [
        "unknown",
        "completed",
        "incomplete",
        "disputed",
        "partial",
        "not_completed",
      ],
      exception_state: ["open", "investigating", "resolved", "dismissed"],
      operator_role: ["ops_admin", "ops_user"],
      participant_account_status: ["active", "disabled"],
      participant_scope_kind: ["worker", "contractor"],
      payment_state: [
        "unknown",
        "unpaid",
        "paid",
        "disputed",
        "pending",
        "partial",
      ],
      proposed_action_ambiguity_state: ["clear", "ambiguous", "unresolved"],
      proposed_action_risk_tier: [
        "informational",
        "operational",
        "trust",
        "economic",
      ],
      proposed_action_state: [
        "pending",
        "approved",
        "rejected",
        "executed",
        "expired",
      ],
      record_status: ["draft", "active", "inactive"],
      reuse_preference: ["unknown", "would_reuse", "would_not_reuse"],
      workmark_evidence_state: [
        "pending",
        "corroborated",
        "conflicted",
        "operator_resolved",
      ],
      workmark_lifecycle: ["draft", "confirmed", "corrected", "voided"],
      workmark_origin: [
        "operator_recorded",
        "historical_claim",
        "channel_event",
        "assignment_closeout",
      ],
    },
  },
} as const

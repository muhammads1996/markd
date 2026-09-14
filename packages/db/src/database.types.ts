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
      assignments: {
        Row: {
          agreed_rate_cents: number | null
          archived_at: string | null
          created_at: string
          currency: string | null
          ends_on: string
          id: string
          labour_request_id: string
          organisation_id: string
          site_id: string | null
          source_channel_event_id: string | null
          source_proposed_action_id: string | null
          starts_on: string
          state: Database["public"]["Enums"]["assignment_state"]
          updated_at: string
          worker_id: string
        }
        Insert: {
          agreed_rate_cents?: number | null
          archived_at?: string | null
          created_at?: string
          currency?: string | null
          ends_on: string
          id?: string
          labour_request_id: string
          organisation_id: string
          site_id?: string | null
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          starts_on: string
          state?: Database["public"]["Enums"]["assignment_state"]
          updated_at?: string
          worker_id: string
        }
        Update: {
          agreed_rate_cents?: number | null
          archived_at?: string | null
          created_at?: string
          currency?: string | null
          ends_on?: string
          id?: string
          labour_request_id?: string
          organisation_id?: string
          site_id?: string | null
          source_channel_event_id?: string | null
          source_proposed_action_id?: string | null
          starts_on?: string
          state?: Database["public"]["Enums"]["assignment_state"]
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_labour_request_id_fkey"
            columns: ["labour_request_id"]
            isOneToOne: false
            referencedRelation: "labour_requests"
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
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
      channel_events: {
        Row: {
          channel: string
          created_at: string
          id: string
          payload: Json
          provider_event_id: string
          received_at: string
          sender_phone_number: string | null
        }
        Insert: {
          channel: string
          created_at?: string
          id?: string
          payload?: Json
          provider_event_id: string
          received_at?: string
          sender_phone_number?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          payload?: Json
          provider_event_id?: string
          received_at?: string
          sender_phone_number?: string | null
        }
        Relationships: []
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
            referencedRelation: "workmarks"
            referencedColumns: ["id"]
          },
        ]
      }
      labour_requests: {
        Row: {
          archived_at: string | null
          created_at: string
          currency: string | null
          headcount: number
          id: string
          needed_at: string | null
          needed_from: string
          needed_to: string
          notes: string | null
          organisation_id: string
          rate_cents: number | null
          requested_by_contact_id: string | null
          site_id: string | null
          source: string
          state: string
          terms: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          currency?: string | null
          headcount: number
          id?: string
          needed_at?: string | null
          needed_from: string
          needed_to: string
          notes?: string | null
          organisation_id: string
          rate_cents?: number | null
          requested_by_contact_id?: string | null
          site_id?: string | null
          source?: string
          state?: string
          terms?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          currency?: string | null
          headcount?: number
          id?: string
          needed_at?: string | null
          needed_from?: string
          needed_to?: string
          notes?: string | null
          organisation_id?: string
          rate_cents?: number | null
          requested_by_contact_id?: string | null
          site_id?: string | null
          source?: string
          state?: string
          terms?: string | null
          updated_at?: string
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
            foreignKeyName: "labour_requests_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
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
      organisations: {
        Row: {
          archived_at: string | null
          created_at: string
          display_name: string
          id: string
          legal_name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          display_name: string
          id?: string
          legal_name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          display_name?: string
          id?: string
          legal_name?: string
          updated_at?: string
        }
        Relationships: []
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
          archived_at: string | null
          channel_event_id: string
          created_at: string
          id: string
          payload: Json
          risk_tier: number
          state: Database["public"]["Enums"]["proposed_action_state"]
          updated_at: string
        }
        Insert: {
          action_type: string
          archived_at?: string | null
          channel_event_id: string
          created_at?: string
          id?: string
          payload?: Json
          risk_tier: number
          state?: Database["public"]["Enums"]["proposed_action_state"]
          updated_at?: string
        }
        Update: {
          action_type?: string
          archived_at?: string | null
          channel_event_id?: string
          created_at?: string
          id?: string
          payload?: Json
          risk_tier?: number
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
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
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
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
      worker_profiles: {
        Row: {
          archived_at: string | null
          created_at: string
          person_id: string
          preferred_name: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          person_id: string
          preferred_name?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          person_id?: string
          preferred_name?: string | null
          updated_at?: string
        }
        Relationships: [
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
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
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
            referencedRelation: "skills"
            referencedColumns: ["id"]
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
          id: string
          lifecycle: Database["public"]["Enums"]["workmark_lifecycle"]
          organisation_contact_id: string | null
          organisation_id: string
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
          id?: string
          lifecycle?: Database["public"]["Enums"]["workmark_lifecycle"]
          organisation_contact_id?: string | null
          organisation_id: string
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
          id?: string
          lifecycle?: Database["public"]["Enums"]["workmark_lifecycle"]
          organisation_contact_id?: string | null
          organisation_id?: string
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
            referencedRelation: "worker_profiles"
            referencedColumns: ["person_id"]
          },
        ]
      }
    }
    Functions: {
      authorize_worker_media_read: {
        Args: { requested_asset_id: string; requested_expires_in: number }
        Returns: {
          bucket_id: string
          object_path: string
        }[]
      }
      current_operator_role: {
        Args: never
        Returns: Database["public"]["Enums"]["operator_role"]
      }
      is_active_operator: { Args: never; Returns: boolean }
      is_ops_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      assignment_state:
        | "proposed"
        | "contacted"
        | "worker_accepted"
        | "contractor_confirmed"
        | "cancelled"
        | "no_show"
        | "completed"
      attendance_outcome: "unknown" | "attended" | "no_show" | "partial"
      claim_stance:
        | "asserted"
        | "confirmed"
        | "disputed"
        | "corrected"
        | "withdrawn"
      completion_outcome: "unknown" | "completed" | "incomplete" | "disputed"
      exception_state: "open" | "investigating" | "resolved" | "dismissed"
      operator_role: "ops_admin" | "ops_user"
      payment_state: "unknown" | "unpaid" | "paid" | "disputed"
      proposed_action_state:
        | "pending"
        | "approved"
        | "rejected"
        | "executed"
        | "expired"
      reuse_preference: "unknown" | "would_reuse" | "would_not_reuse"
      workmark_lifecycle: "draft" | "confirmed" | "corrected" | "voided"
      workmark_origin:
        | "operator_recorded"
        | "historical_claim"
        | "channel_event"
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
      assignment_state: [
        "proposed",
        "contacted",
        "worker_accepted",
        "contractor_confirmed",
        "cancelled",
        "no_show",
        "completed",
      ],
      attendance_outcome: ["unknown", "attended", "no_show", "partial"],
      claim_stance: [
        "asserted",
        "confirmed",
        "disputed",
        "corrected",
        "withdrawn",
      ],
      completion_outcome: ["unknown", "completed", "incomplete", "disputed"],
      exception_state: ["open", "investigating", "resolved", "dismissed"],
      operator_role: ["ops_admin", "ops_user"],
      payment_state: ["unknown", "unpaid", "paid", "disputed"],
      proposed_action_state: [
        "pending",
        "approved",
        "rejected",
        "executed",
        "expired",
      ],
      reuse_preference: ["unknown", "would_reuse", "would_not_reuse"],
      workmark_lifecycle: ["draft", "confirmed", "corrected", "voided"],
      workmark_origin: [
        "operator_recorded",
        "historical_claim",
        "channel_event",
      ],
    },
  },
} as const

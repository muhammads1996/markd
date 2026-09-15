-- FLO-104 deterministic synthetic seed. These identities are fictional test data.
select set_config('app.actor_kind', 'system', true);

insert into public.languages (id, code, name) values
  ('00000000-0000-4000-8000-000000000001', 'en', 'English'),
  ('00000000-0000-4000-8000-000000000003', 'af', 'Afrikaans'),
  ('00000000-0000-4000-8000-000000000002', 'xh', 'isiXhosa');
insert into public.areas (id, name, locality) values
  ('08000000-0000-4000-8000-000000000001', 'Khayelitsha', 'Cape Town'),
  ('08000000-0000-4000-8000-000000000002', 'Bellville', 'Cape Town');
insert into public.people (id, display_name, given_name, family_name, preferred_language_id, preferred_communication_mode) values
  ('10000000-0000-4000-8000-000000000001', 'Anele Sample', 'Anele', 'Sample', '00000000-0000-4000-8000-000000000002', 'text'),
  ('10000000-0000-4000-8000-000000000002', 'Jordan Example', 'Jordan', 'Example', '00000000-0000-4000-8000-000000000003', 'call'),
  ('10000000-0000-4000-8000-000000000003', 'Lebo Sample', 'Lebo', 'Sample', '00000000-0000-4000-8000-000000000001', 'voice');
insert into public.person_phone_numbers (id, person_id, phone_number, is_primary) values
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '+27820000001', true),
  ('11000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '+27820000002', true);
insert into public.person_languages (person_id, language_id, proficiency) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'fluent'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'native');
insert into public.worker_profiles (person_id, preferred_name) values
  ('10000000-0000-4000-8000-000000000001', 'Anele'),
  ('10000000-0000-4000-8000-000000000003', 'Lebo');
update public.worker_profiles set base_area_id = '08000000-0000-4000-8000-000000000001' where person_id in ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003');
insert into public.worker_participation_preferences (worker_id, read_aloud_enabled, app_participation) values
  ('10000000-0000-4000-8000-000000000001', false, 'whatsapp_only'),
  ('10000000-0000-4000-8000-000000000003', true, 'interested');
insert into public.worker_area_preferences (worker_id, area_id, is_familiar, willing_to_travel) values
  ('10000000-0000-4000-8000-000000000001', '08000000-0000-4000-8000-000000000001', true, true),
  ('10000000-0000-4000-8000-000000000001', '08000000-0000-4000-8000-000000000002', false, true),
  ('10000000-0000-4000-8000-000000000003', '08000000-0000-4000-8000-000000000001', true, false);
insert into public.organisations (id, legal_name, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'Example Build (Pty) Ltd', 'Example Build');
insert into public.organisation_operating_areas (organisation_id, area_id) values
  ('20000000-0000-4000-8000-000000000001', '08000000-0000-4000-8000-000000000001');
insert into public.organisation_contacts (id, organisation_id, person_id, role_name, is_primary) values
  ('21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'Site supervisor', true);
insert into public.sites (id, organisation_id, name, locality) values
  ('22000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Example Site', 'Cape Town');
insert into public.skills (id, name) values
  ('30000000-0000-4000-8000-000000000001', 'General labour');
insert into public.worker_skill_evidence (id, worker_id, skill_id, source, confidence) values
  ('31000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'synthetic seed', 1.00);
insert into public.worker_primary_skills (worker_id, skill_id) values
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001');
insert into public.organisation_typical_skills (organisation_id, skill_id) values
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001');
insert into public.workmarks (id, worker_id, organisation_id, site_id, organisation_contact_id, work_started_on, work_ended_on, origin, lifecycle, attendance, completion, payment, organisation_reuse_preference, source) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '2026-09-01', '2026-09-01', 'operator_recorded', 'confirmed', 'attended', 'completed', 'paid', 'would_reuse', 'synthetic seed');
insert into public.workmark_skills (workmark_id, skill_id) values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001');
insert into public.verification_claims (id, workmark_id, stance, value, claimant_person_id, source) values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'confirmed', '{"attendance":"attended"}', '10000000-0000-4000-8000-000000000002', 'synthetic seed');
insert into public.labour_requests (id, organisation_id, site_id, requested_by_contact_id, needed_from, needed_to, needed_at, headcount, rate_cents, currency, terms, source, notes) values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '2026-09-08', '2026-09-09', '07:00', 1, 25000, 'ZAR', 'Synthetic day-rate terms', 'synthetic seed', 'Synthetic only');
insert into public.labour_requirements (id, labour_request_id, skill_id, headcount) values
  ('61000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 1);
insert into public.assignments (id, labour_request_id, worker_id, organisation_id, site_id, starts_on, ends_on, state, agreed_rate_cents, currency) values
  ('62000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '2026-09-08', '2026-09-09', 'contractor_confirmed', 25000, 'ZAR');
insert into public.workmarks (id, worker_id, organisation_id, assignment_id, site_id, work_started_on, work_ended_on, origin, lifecycle, attendance, completion, payment, organisation_reuse_preference, source) values
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '2026-09-08', '2026-09-09', 'operator_recorded', 'confirmed', 'attended', 'completed', 'paid', 'would_reuse', 'synthetic seed'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', null, '22000000-0000-4000-8000-000000000001', '2025-05-01', '2025-05-01', 'historical_claim', 'draft', 'unknown', 'unknown', 'unknown', 'unknown', 'synthetic seed');
insert into public.crew_links (id, worker_a_id, worker_b_id, source) values
  ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'synthetic seed');
insert into public.availability_signals (id, worker_id, available_from, available_to, status, source) values
  ('71000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '2026-09-15', '2026-09-30', 'available', 'synthetic seed');
insert into public.channel_events (id, channel, provider_event_id, sender_phone_number, payload) values
  ('72000000-0000-4000-8000-000000000001', 'whatsapp', 'synthetic-event-1', '+27820000002', '{"synthetic":true}');
insert into public.proposed_actions (id, channel_event_id, action_type, risk_tier, payload, state) values
  ('73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'propose_workmark', 'operational', '{"synthetic":true}', 'approved');
insert into public.exception_cases (id, assignment_id, category, opened_by_person_id, source) values
  ('74000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', 'synthetic follow-up', '10000000-0000-4000-8000-000000000002', 'synthetic seed');

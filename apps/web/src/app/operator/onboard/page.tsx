import { notFound, redirect } from "next/navigation";

import { OperatorChrome } from "../../../components/operator/OperatorChrome";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import {
  OnboardingForm,
  type OrganisationInitialValues,
  type WorkerInitialValues,
} from "./OnboardingForm";
import styles from "./onboard.module.css";

type PageProps = {
  searchParams: Promise<{ organisationId?: string; workerId?: string }>;
};
type Row = Record<string, unknown>;

export default async function OnboardPage({ searchParams }: PageProps) {
  const { organisationId, workerId } = await searchParams;
  if (organisationId && workerId) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/sign-in");

  const [accountResult, areasResult, languagesResult, skillsResult] =
    await Promise.all([
      supabase
        .from("operator_accounts")
        .select("role")
        .is("archived_at", null)
        .maybeSingle(),
      supabase
        .from("areas")
        .select("id, name")
        .is("archived_at", null)
        .order("name"),
      supabase
        .from("languages")
        .select("id, name")
        .is("archived_at", null)
        .order("name"),
      supabase
        .from("skills")
        .select("id, name")
        .is("archived_at", null)
        .order("name"),
    ]);
  throwIfQueryError(accountResult, "operator access");
  throwIfQueryError(areasResult, "onboarding areas");
  throwIfQueryError(languagesResult, "onboarding languages");
  throwIfQueryError(skillsResult, "onboarding skills");
  if (!accountResult.data) redirect("/sign-in?reason=not-authorised");

  const initial = workerId
    ? await loadWorker(supabase, workerId)
    : organisationId
      ? await loadOrganisation(supabase, organisationId)
      : undefined;

  return (
    <OperatorChrome>
      <main className={styles.shell}>
        <header className={styles.pageHeader}>
          <p className={styles.eyebrow}>Operator onboarding</p>
          <h1>{initial ? "Update MARKD record" : "Add someone to MARKD"}</h1>
          <p>
            Capture a useful record in the field, then enrich it when you have
            time.
          </p>
        </header>
        <OnboardingForm
          areas={toReferences(areasResult.data)}
          {...(initial ? { initial } : {})}
          languages={toReferences(languagesResult.data)}
          skills={toReferences(skillsResult.data)}
        />
      </main>
    </OperatorChrome>
  );
}

async function loadWorker(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  workerId: string,
): Promise<WorkerInitialValues> {
  const [
    profileResult,
    phoneResult,
    skillsResult,
    participationResult,
    areaPreferencesResult,
  ] = await Promise.all([
    supabase
      .from("worker_profiles")
      .select(
        "person_id, preferred_name, base_area_id, record_status, people(display_name, preferred_language_id, preferred_communication_mode)",
      )
      .eq("person_id", workerId)
      .is("archived_at", null)
      .maybeSingle(),
    supabase
      .from("person_phone_numbers")
      .select("phone_number")
      .eq("person_id", workerId)
      .eq("is_primary", true)
      .is("archived_at", null)
      .maybeSingle(),
    supabase
      .from("worker_primary_skills")
      .select("skill_id")
      .eq("worker_id", workerId)
      .is("archived_at", null),
    supabase
      .from("worker_participation_preferences")
      .select("read_aloud_enabled, app_participation")
      .eq("worker_id", workerId)
      .maybeSingle(),
    supabase
      .from("worker_area_preferences")
      .select("area_id, is_familiar, willing_to_travel")
      .eq("worker_id", workerId)
      .is("archived_at", null),
  ]);
  throwIfQueryError(profileResult, "worker record");
  throwIfQueryError(phoneResult, "worker phone number");
  throwIfQueryError(skillsResult, "worker onboarding skills");
  throwIfQueryError(participationResult, "worker participation preferences");
  throwIfQueryError(areaPreferencesResult, "worker area preferences");
  const profile = asRow(profileResult.data);
  const person = asRow(profile?.people);
  const phone = asRow(phoneResult.data);
  const participation = asRow(participationResult.data);
  if (!profile || !person || !phone) notFound();
  return {
    baseAreaId: stringValue(profile.base_area_id),
    displayName: stringValue(person.display_name),
    familiarAreaIds: preferredAreaIds(
      areaPreferencesResult.data,
      "is_familiar",
    ),
    id: workerId,
    kind: "worker",
    appParticipation: appParticipation(participation?.app_participation),
    preferredCommunicationMode: communicationMode(
      person.preferred_communication_mode,
    ),
    preferredLanguageId: stringValue(person.preferred_language_id),
    primarySkillIds: rowIds(skillsResult.data, "skill_id"),
    readAloudEnabled: participation?.read_aloud_enabled === true,
    recordStatus: status(profile.record_status),
    whatsappPhone: stringValue(phone.phone_number),
    willingToTravelAreaIds: preferredAreaIds(
      areaPreferencesResult.data,
      "willing_to_travel",
    ),
  };
}

async function loadOrganisation(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organisationId: string,
): Promise<OrganisationInitialValues> {
  const [organisationResult, contactsResult, areasResult, skillsResult] =
    await Promise.all([
      supabase
        .from("organisations")
        .select("id, display_name, legal_name, record_status")
        .eq("id", organisationId)
        .is("archived_at", null)
        .maybeSingle(),
      supabase
        .from("organisation_contacts")
        .select("person_id, people(display_name)")
        .eq("organisation_id", organisationId)
        .eq("is_primary", true)
        .is("archived_at", null)
        .maybeSingle(),
      supabase
        .from("organisation_operating_areas")
        .select("area_id")
        .eq("organisation_id", organisationId)
        .is("archived_at", null),
      supabase
        .from("organisation_typical_skills")
        .select("skill_id")
        .eq("organisation_id", organisationId)
        .is("archived_at", null),
    ]);
  const organisation = asRow(organisationResult.data);
  const contact = asRow(contactsResult.data);
  const person = asRow(contact?.people);
  throwIfQueryError(organisationResult, "organisation record");
  throwIfQueryError(contactsResult, "organisation contact");
  throwIfQueryError(areasResult, "organisation operating areas");
  throwIfQueryError(skillsResult, "organisation typical work");
  if (!organisation || !contact || !person) notFound();
  const phoneResult = await supabase
    .from("person_phone_numbers")
    .select("phone_number")
    .eq("person_id", stringValue(contact.person_id))
    .eq("is_primary", true)
    .is("archived_at", null)
    .maybeSingle();
  const phone = asRow(phoneResult.data);
  throwIfQueryError(phoneResult, "organisation contact phone number");
  if (!phone) notFound();
  return {
    contactName: stringValue(person.display_name),
    id: organisationId,
    kind: "organisation",
    operatingAreaIds: rowIds(areasResult.data, "area_id"),
    organisationName: nullableString(organisation.display_name),
    recordStatus: status(organisation.record_status),
    typicalSkillIds: rowIds(skillsResult.data, "skill_id"),
    whatsappPhone: stringValue(phone.phone_number),
  };
}

function asRow(value: unknown): Row | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : undefined;
}
function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function rowIds(value: unknown, key: string): string[] {
  return Array.isArray(value)
    ? value
        .map(asRow)
        .flatMap((row) =>
          row && typeof row[key] === "string" ? [row[key]] : [],
        )
    : [];
}
function preferredAreaIds(value: unknown, preferenceKey: string): string[] {
  return Array.isArray(value)
    ? value
        .map(asRow)
        .flatMap((row) =>
          row && row[preferenceKey] === true && typeof row.area_id === "string"
            ? [row.area_id]
            : [],
        )
    : [];
}
function toReferences(value: unknown): { id: string; name: string }[] {
  return Array.isArray(value)
    ? value
        .map(asRow)
        .flatMap((row) =>
          row && typeof row.id === "string" && typeof row.name === "string"
            ? [{ id: row.id, name: row.name }]
            : [],
        )
    : [];
}
function status(value: unknown): "active" | "inactive" {
  return value === "inactive" ? "inactive" : "active";
}
function communicationMode(value: unknown): "text" | "voice" | "call" {
  return value === "text" || value === "voice" ? value : "call";
}
function appParticipation(
  value: unknown,
): "unknown" | "whatsapp_only" | "interested" | "using" {
  return value === "whatsapp_only" ||
    value === "interested" ||
    value === "using"
    ? value
    : "unknown";
}
function throwIfQueryError(result: { error: unknown }, context: string): void {
  if (result.error) throw new Error(`Unable to load ${context}.`);
}

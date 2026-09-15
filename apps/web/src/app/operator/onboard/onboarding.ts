export type RecordStatus = "active" | "inactive";
export type PreferredCommunicationMode = "text" | "voice" | "call";
export type AppParticipation =
  "unknown" | "whatsapp_only" | "interested" | "using";

export type WorkerRecordInput = {
  kind: "worker";
  displayName: string;
  whatsappPhone: string;
  preferredLanguageId: string;
  preferredCommunicationMode: PreferredCommunicationMode;
  baseAreaId: string;
  primarySkillIds: string[];
  recordStatus: RecordStatus;
  appParticipation: AppParticipation;
  readAloudEnabled: boolean;
  familiarAreaIds: string[];
  willingToTravelAreaIds: string[];
};

export type WorkerOnboardingInput = WorkerRecordInput & { portrait: File };

export type OrganisationOnboardingInput = {
  kind: "organisation";
  organisationName: string | null;
  contactName: string;
  whatsappPhone: string;
  operatingAreaIds: string[];
  typicalSkillIds: string[];
  recordStatus: RecordStatus;
};

export type OnboardingInput =
  WorkerOnboardingInput | OrganisationOnboardingInput;

export type OnboardingFormState = {
  draft?: WorkerOnboardingDraft;
  error?: string;
  saved?: { kind: OnboardingInput["kind"]; id: string };
};

export type WorkerOnboardingDraft = {
  workerId: string;
  portraitAssetId: string;
  bucketId: string;
  objectPath: string;
};

const E164_PHONE = /^\+[1-9]\d{1,14}$/;
const MAX_PORTRAIT_BYTES = 5 * 1024 * 1024;
const PORTRAIT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function requiredText(value: FormDataEntryValue | null, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

export function normalizeE164Phone(value: string): string {
  const normalized = value.trim().replace(/[\s().-]/g, "");
  if (!E164_PHONE.test(normalized)) {
    throw new Error(
      "Enter a WhatsApp number in international format, for example +27821234567.",
    );
  }
  return normalized;
}

function selectedIds(formData: FormData, name: string): string[] {
  return [
    ...new Set(
      formData
        .getAll(name)
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        ),
    ),
  ];
}

function recordStatus(value: FormDataEntryValue | null): RecordStatus {
  if (value === "active" || value === "inactive") return value;
  throw new Error("Choose a status.");
}

function preferredCommunicationMode(
  value: FormDataEntryValue | null,
): PreferredCommunicationMode {
  if (value === "text" || value === "voice" || value === "call") return value;
  throw new Error("Choose a communication preference.");
}

function appParticipation(value: FormDataEntryValue | null): AppParticipation {
  if (
    value === "unknown" ||
    value === "whatsapp_only" ||
    value === "interested" ||
    value === "using"
  ) {
    return value;
  }
  throw new Error("Choose app participation.");
}

function portrait(value: FormDataEntryValue | null): File {
  if (!(value instanceof File) || value.size === 0) {
    throw new Error("A portrait is required for a worker.");
  }
  if (!PORTRAIT_TYPES.has(value.type) || value.size > MAX_PORTRAIT_BYTES) {
    throw new Error("Use a JPG, PNG, or WebP portrait up to 5 MB.");
  }
  return value;
}

export function parseWorkerOnboarding(
  formData: FormData,
): WorkerOnboardingInput {
  return {
    ...parseWorkerRecord(formData),
    portrait: portrait(formData.get("portrait")),
  };
}

export function parseWorkerUpdate(formData: FormData): WorkerRecordInput {
  return parseWorkerRecord(formData);
}

function parseWorkerRecord(formData: FormData): WorkerRecordInput {
  const primarySkillIds = selectedIds(formData, "primarySkillIds");
  if (primarySkillIds.length === 0)
    throw new Error("Choose at least one primary skill.");

  return {
    kind: "worker",
    displayName: requiredText(formData.get("displayName"), "Preferred name"),
    whatsappPhone: normalizeE164Phone(
      requiredText(formData.get("whatsappPhone"), "WhatsApp number"),
    ),
    preferredLanguageId: requiredText(
      formData.get("preferredLanguageId"),
      "Preferred language",
    ),
    preferredCommunicationMode: preferredCommunicationMode(
      formData.get("preferredCommunicationMode"),
    ),
    baseAreaId: requiredText(formData.get("baseAreaId"), "Base area"),
    primarySkillIds,
    recordStatus: recordStatus(formData.get("recordStatus")),
    appParticipation: appParticipation(formData.get("appParticipation")),
    readAloudEnabled: formData.get("readAloudEnabled") === "on",
    familiarAreaIds: selectedIds(formData, "familiarAreaIds"),
    willingToTravelAreaIds: selectedIds(formData, "willingToTravelAreaIds"),
  };
}

export function parseOrganisationOnboarding(
  formData: FormData,
): OrganisationOnboardingInput {
  const organisationName =
    typeof formData.get("organisationName") === "string"
      ? formData.get("organisationName")!.toString().trim() || null
      : null;
  const operatingAreaIds = selectedIds(formData, "operatingAreaIds");
  const typicalSkillIds = selectedIds(formData, "typicalSkillIds");
  if (operatingAreaIds.length === 0)
    throw new Error("Choose at least one operating area.");
  if (typicalSkillIds.length === 0)
    throw new Error("Choose at least one typical work type.");

  return {
    kind: "organisation",
    organisationName,
    contactName: requiredText(formData.get("contactName"), "Contact person"),
    whatsappPhone: normalizeE164Phone(
      requiredText(formData.get("whatsappPhone"), "WhatsApp number"),
    ),
    operatingAreaIds,
    typicalSkillIds,
    recordStatus: recordStatus(formData.get("recordStatus")),
  };
}

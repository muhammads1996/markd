"use client";

import { useActionState, useState } from "react";

import { submitOnboarding } from "./actions";
import type {
  AppParticipation,
  OnboardingFormState,
  PreferredCommunicationMode,
  RecordStatus,
} from "./onboarding";
import styles from "./onboard.module.css";

type Reference = { id: string; name: string };

export type WorkerInitialValues = {
  appParticipation?: AppParticipation;
  baseAreaId: string;
  displayName: string;
  familiarAreaIds?: string[];
  id: string;
  kind: "worker";
  preferredCommunicationMode?: PreferredCommunicationMode;
  preferredLanguageId: string;
  primarySkillIds: string[];
  readAloudEnabled?: boolean;
  recordStatus: RecordStatus;
  whatsappPhone: string;
  willingToTravelAreaIds?: string[];
};

export type OrganisationInitialValues = {
  contactName: string;
  id: string;
  kind: "organisation";
  operatingAreaIds: string[];
  organisationName: string | null;
  recordStatus: RecordStatus;
  typicalSkillIds: string[];
  whatsappPhone: string;
};

type InitialValues = WorkerInitialValues | OrganisationInitialValues;
const initialState: OnboardingFormState = {};

export function OnboardingForm({
  areas,
  initial,
  languages,
  skills,
}: {
  areas: Reference[];
  initial?: InitialValues | undefined;
  languages: Reference[];
  skills: Reference[];
}) {
  const [kind, setKind] = useState<"worker" | "organisation">(
    initial?.kind ?? "worker",
  );
  const [state, action, pending] = useActionState(
    submitOnboarding,
    initialState,
  );
  const editing = Boolean(initial);
  const worker = initial?.kind === "worker" ? initial : undefined;
  const organisation = initial?.kind === "organisation" ? initial : undefined;

  return (
    <form action={action} className={styles.form} encType="multipart/form-data">
      {editing ? (
        <p className={styles.hint}>
          Edit {kind === "worker" ? "worker" : "contractor"} details.
        </p>
      ) : (
        <fieldset className={styles.kind}>
          <legend>Who are you adding?</legend>
          <label>
            <input
              checked={kind === "worker"}
              name="recordType"
              onChange={() => setKind("worker")}
              type="radio"
              value="worker"
            />{" "}
            Worker
          </label>
          <label>
            <input
              checked={kind === "organisation"}
              name="recordType"
              onChange={() => setKind("organisation")}
              type="radio"
              value="organisation"
            />{" "}
            Contractor or organisation
          </label>
        </fieldset>
      )}
      <input name="kind" type="hidden" value={kind} />
      {worker && <input name="workerId" type="hidden" value={worker.id} />}
      {organisation && (
        <input name="organisationId" type="hidden" value={organisation.id} />
      )}
      {state.draft && (
        <input
          name="requestedWorkerId"
          type="hidden"
          value={state.draft.workerId}
        />
      )}
      {kind === "worker" ? (
        <WorkerFields
          areas={areas}
          editing={editing}
          initial={worker}
          languages={languages}
          skills={skills}
        />
      ) : (
        <OrganisationFields
          areas={areas}
          initial={organisation}
          skills={skills}
        />
      )}
      {state.error && (
        <p aria-live="polite" className={styles.error}>
          {state.error}
        </p>
      )}
      {state.draft && (
        <p className={styles.hint}>
          Your worker draft is safe. Retry the portrait upload or cancel the
          draft.
        </p>
      )}
      {state.saved && (
        <p aria-live="polite" className={styles.success}>
          Saved. Record ID: {state.saved.id}
        </p>
      )}
      <button disabled={pending} name="intent" type="submit" value="save">
        {pending
          ? "Saving…"
          : state.draft
            ? "Retry portrait and save"
            : `Save ${kind === "worker" ? "worker" : "contractor"}`}
      </button>
      {state.draft && (
        <button
          className={styles.cancel}
          disabled={pending}
          formNoValidate
          name="intent"
          type="submit"
          value="cancel-worker"
        >
          Cancel worker draft
        </button>
      )}
    </form>
  );
}

function WorkerFields({
  areas,
  editing,
  initial,
  languages,
  skills,
}: {
  areas: Reference[];
  editing: boolean;
  initial?: WorkerInitialValues | undefined;
  languages: Reference[];
  skills: Reference[];
}) {
  return (
    <section aria-labelledby="worker-fields">
      <h2 id="worker-fields">Worker details</h2>
      <p className={styles.hint}>
        The essentials first. You can add the optional preferences later.
      </p>
      {!editing && (
        <label>
          Portrait
          <input
            accept="image/jpeg,image/png,image/webp"
            name="portrait"
            required
            type="file"
          />
        </label>
      )}
      <label>
        Preferred name
        <input
          autoComplete="name"
          defaultValue={initial?.displayName}
          name="displayName"
          placeholder="e.g. Themba"
          required
        />
      </label>
      <label>
        WhatsApp number
        <input
          autoComplete="tel"
          defaultValue={initial?.whatsappPhone}
          inputMode="tel"
          name="whatsappPhone"
          placeholder="+27821234567"
          required
        />
      </label>
      <label>
        Preferred language
        <Select
          defaultValue={initial?.preferredLanguageId ?? ""}
          name="preferredLanguageId"
          references={languages}
          placeholder="Choose language"
        />
      </label>
      <label>
        Communication preference
        <select
          defaultValue={initial?.preferredCommunicationMode ?? "call"}
          name="preferredCommunicationMode"
        >
          <option value="call">Call</option>
          <option value="text">Text</option>
          <option value="voice">Voice note</option>
        </select>
      </label>
      <label>
        Base area
        <Select
          defaultValue={initial?.baseAreaId ?? ""}
          name="baseAreaId"
          references={areas}
          placeholder="Choose base area"
        />
      </label>
      <Checkboxes
        ids={initial?.primarySkillIds}
        legend="Primary skills"
        name="primarySkillIds"
        references={skills}
        required
      />
      <Status value={initial?.recordStatus} />
      <details className={styles.secondary}>
        <summary>Optional participation preferences</summary>
        <label>
          App participation
          <select
            defaultValue={initial?.appParticipation ?? "unknown"}
            name="appParticipation"
          >
            <option value="unknown">Not discussed</option>
            <option value="whatsapp_only">WhatsApp only</option>
            <option value="interested">Interested in the app</option>
            <option value="using">Uses the app</option>
          </select>
        </label>
        <label className={styles.checkline}>
          <input
            defaultChecked={initial?.readAloudEnabled}
            name="readAloudEnabled"
            type="checkbox"
          />{" "}
          Read aloud where available
        </label>
        <Checkboxes
          ids={initial?.familiarAreaIds}
          legend="Familiar areas"
          name="familiarAreaIds"
          references={areas}
        />
        <Checkboxes
          ids={initial?.willingToTravelAreaIds}
          legend="Willing to travel to"
          name="willingToTravelAreaIds"
          references={areas}
        />
      </details>
    </section>
  );
}

function OrganisationFields({
  areas,
  initial,
  skills,
}: {
  areas: Reference[];
  initial?: OrganisationInitialValues | undefined;
  skills: Reference[];
}) {
  return (
    <section aria-labelledby="organisation-fields">
      <h2 id="organisation-fields">Contractor details</h2>
      <p className={styles.hint}>
        A trading name is useful, but not required to save the contact.
      </p>
      <label>
        Organisation or trading name
        <input
          defaultValue={initial?.organisationName ?? ""}
          name="organisationName"
          placeholder="e.g. Maseko Plumbing"
        />
      </label>
      <label>
        Contact person
        <input
          autoComplete="name"
          defaultValue={initial?.contactName}
          name="contactName"
          placeholder="e.g. Lerato Maseko"
          required
        />
      </label>
      <label>
        WhatsApp number
        <input
          autoComplete="tel"
          defaultValue={initial?.whatsappPhone}
          inputMode="tel"
          name="whatsappPhone"
          placeholder="+27821234567"
          required
        />
      </label>
      <Checkboxes
        ids={initial?.operatingAreaIds}
        legend="Operating areas"
        name="operatingAreaIds"
        references={areas}
        required
      />
      <Checkboxes
        ids={initial?.typicalSkillIds}
        legend="Typical work"
        name="typicalSkillIds"
        references={skills}
        required
      />
      <Status value={initial?.recordStatus} />
    </section>
  );
}

function Select({
  defaultValue,
  name,
  placeholder,
  references,
}: {
  defaultValue: string;
  name: string;
  placeholder: string;
  references: Reference[];
}) {
  return (
    <select defaultValue={defaultValue} name={name} required>
      <option disabled value="">
        {placeholder}
      </option>
      {references.map((reference) => (
        <option key={reference.id} value={reference.id}>
          {reference.name}
        </option>
      ))}
    </select>
  );
}

function Checkboxes({
  ids = [],
  legend,
  name,
  references,
  required = false,
}: {
  ids?: string[] | undefined;
  legend: string;
  name: string;
  references: Reference[];
  required?: boolean;
}) {
  return (
    <fieldset aria-required={required}>
      <legend>{legend}</legend>
      <div className={styles.options}>
        {references.map((reference) => (
          <label key={reference.id}>
            <input
              defaultChecked={ids.includes(reference.id)}
              name={name}
              type="checkbox"
              value={reference.id}
            />{" "}
            {reference.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Status({ value = "active" }: { value?: RecordStatus | undefined }) {
  return (
    <label>
      Record status
      <select defaultValue={value} name="recordStatus">
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
    </label>
  );
}

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  createLabourRequest,
  getParticipantIdentity,
  type ParticipantIdentity,
} from "../../lib/participant/commands";
import { Button, participantStyles as styles } from "./components";

export function ContractorHireForm() {
  const router = useRouter();
  const [identity, setIdentity] = useState<ParticipantIdentity | null>(null);
  const [contactId, setContactId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void getParticipantIdentity()
      .then((result) => {
        setIdentity(result);
        setContactId(
          result.organisationContacts[0]?.organisationContactId ?? "",
        );
      })
      .catch((identityError) => {
        setError(
          identityError instanceof Error
            ? identityError.message
            : "Could not load contractor access.",
        );
      });
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedContact = identity?.organisationContacts.find(
      (contact) => contact.organisationContactId === contactId,
    );
    if (!selectedContact) {
      setError("No contractor organisation is available for this request.");
      return;
    }
    const formData = new FormData(event.currentTarget);
    const amount = Number(formData.get("amount"));
    setPending(true);
    setError(null);
    try {
      await createLabourRequest({
        contractor_organisation_id: selectedContact.organisationId,
        contractor_contact_id: selectedContact.organisationContactId,
        work_date: String(formData.get("work_date")),
        timezone: String(formData.get("timezone")),
        site_area: String(formData.get("site_area")),
        pay: {
          amount_minor: Math.round(amount * 100),
          currency: String(formData.get("currency")).toUpperCase(),
          basis: formData.get("basis") as
            "daily" | "hourly" | "fixed" | "other",
        },
        requirements: [
          {
            work_type: String(formData.get("work_type")),
            headcount: Number(formData.get("headcount")),
          },
        ],
      });
      router.refresh();
      event.currentTarget.reset();
    } catch (commandError) {
      setError(
        commandError instanceof Error
          ? commandError.message
          : "Request failed.",
      );
    } finally {
      setPending(false);
    }
  }

  if (!identity && !error)
    return <p className={styles.muted}>Loading contractor access...</p>;
  if (!identity?.organisationContacts.length) {
    return (
      <p className={styles.warningText}>
        {error ?? "No contractor organisation is available."}
      </p>
    );
  }

  return (
    <form className={styles.stack} onSubmit={submit}>
      {identity.organisationContacts.length > 1 ? (
        <label>
          Contractor organisation
          <select
            value={contactId}
            onChange={(event) => setContactId(event.target.value)}
            disabled={pending}
          >
            {identity.organisationContacts.map((contact) => (
              <option
                key={contact.organisationContactId}
                value={contact.organisationContactId}
              >
                {contact.organisationId}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        Work date
        <input name="work_date" type="date" required disabled={pending} />
      </label>
      <label>
        Timezone
        <input
          name="timezone"
          defaultValue="Africa/Johannesburg"
          required
          disabled={pending}
        />
      </label>
      <label>
        Site area
        <input name="site_area" required disabled={pending} />
      </label>
      <label>
        Work type
        <input name="work_type" required disabled={pending} />
      </label>
      <label>
        Headcount
        <input
          name="headcount"
          type="number"
          min="1"
          defaultValue="1"
          required
          disabled={pending}
        />
      </label>
      <label>
        Amount
        <input
          name="amount"
          type="number"
          min="0"
          step="0.01"
          required
          disabled={pending}
        />
      </label>
      <label>
        Currency
        <input
          name="currency"
          defaultValue="ZAR"
          minLength={3}
          maxLength={3}
          required
          disabled={pending}
        />
      </label>
      <label>
        Rate basis
        <select name="basis" defaultValue="daily" disabled={pending}>
          <option value="daily">Daily</option>
          <option value="hourly">Hourly</option>
          <option value="fixed">Fixed</option>
          <option value="other">Other</option>
        </select>
      </label>
      <Button type="submit" disabled={pending}>
        Create Labour Request
      </Button>
      {error ? <p className={styles.warningText}>{error}</p> : null}
    </form>
  );
}

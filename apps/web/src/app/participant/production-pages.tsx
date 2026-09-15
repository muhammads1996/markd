import {
  ActionLink,
  EmptyState,
  SettingsRow,
  participantStyles as styles,
} from "../../components/participant";

function Header({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className={styles.pageHeader}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.lede}>{description}</p>
    </header>
  );
}

const support = (
  <p>
    WhatsApp and your MARKD operator remain available for confirmations and
    changes. No critical action requires this app.
  </p>
);

export function WorkerHomePage() {
  return (
    <>
      <Header
        eyebrow="Worker home"
        title="Your work"
        description="Confirmed work will appear here after MARKD and the contractor have confirmed it."
      />
      <EmptyState title="No confirmed work to show">{support}</EmptyState>
    </>
  );
}

export function WorkerWorkPage() {
  return (
    <>
      <Header
        eyebrow="Work"
        title="Work history"
        description="Your participant work history is not yet available in this read-only release."
      />
      <EmptyState title="History is coming later">{support}</EmptyState>
    </>
  );
}

export function WorkerCardPage() {
  return (
    <>
      <Header
        eyebrow="Work Card"
        title="Your Work Card"
        description="A privacy-controlled participant Work Card is not yet connected."
      />
      <EmptyState title="No Work Card data to show">
        <p>
          Your operator can still review your verified work history with you
          through existing MARKD channels.
        </p>
      </EmptyState>
    </>
  );
}

export function WorkerProfilePage() {
  return (
    <>
      <Header
        eyebrow="Profile"
        title="Your settings"
        description="These settings are read-only until participant commands are available."
      />
      <section className={styles.card}>
        <SettingsRow label="Language" value="Managed with your operator" />
        <SettingsRow label="Read aloud" value="Available on work details" />
        <SettingsRow label="WhatsApp" value="Available" />
        <SettingsRow
          label="Travel preferences"
          value="Managed with your operator"
        />
      </section>
    </>
  );
}

export function ContractorHomePage() {
  return (
    <>
      <Header
        eyebrow="Contractor home"
        title="Crew overview"
        description="Live crew and job records are not yet available in the participant app."
      />
      <EmptyState title="No crew data to show">{support}</EmptyState>
    </>
  );
}

export function ContractorHirePage() {
  return (
    <>
      <Header
        eyebrow="Hire"
        title="Request workers"
        description="Hiring remains operator-assisted in this release."
      />
      <EmptyState title="Contact MARKD to hire">
        <p>
          Send the site, date, skills and worker count by WhatsApp. The operator
          will confirm every placement.
        </p>
        <ActionLink href="/participant/contractor" variant="secondary">
          ← Back home
        </ActionLink>
      </EmptyState>
    </>
  );
}

export function ContractorWorkersPage() {
  return (
    <>
      <Header
        eyebrow="Workers"
        title="Known workers"
        description="Participant worker projections and hiring commands are not yet connected."
      />
      <EmptyState title="No workers to show">{support}</EmptyState>
    </>
  );
}

export function ContractorJobsPage() {
  return (
    <>
      <Header
        eyebrow="Jobs"
        title="Your jobs"
        description="Participant job history is not yet available in this read-only release."
      />
      <EmptyState title="No jobs to show">{support}</EmptyState>
    </>
  );
}

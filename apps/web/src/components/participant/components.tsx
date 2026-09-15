import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { getParticipantDictionary, type ParticipantLocale } from "@markd/i18n";

import type {
  ContractorWorkerPresentationModel,
  WorkerAssignmentCardModel,
  WorkCardPresentationModel,
} from "../../lib/participant/types";
import { BottomNav, type ParticipantNavItem } from "./bottom-nav";
import { ReadAloudButton } from "./client-components";
import styles from "./participant.module.css";

export type ParticipantTone = "neutral" | "warning" | "confirmed" | "danger";
export type ParticipantButtonVariant = "primary" | "secondary" | "ghost";

export function ParticipantAppBar({
  connected = true,
}: {
  connected?: boolean;
}) {
  return (
    <header className={styles.appBar}>
      <Link className={styles.wordmark} href="/participant">
        MARKD<span className={styles.wordmarkAccent}>.</span>
      </Link>
      <span className={connected ? styles.connected : styles.muted}>
        {connected ? "● Connected" : "Offline"}
      </span>
    </header>
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: ParticipantTone;
  children: ReactNode;
}) {
  return (
    <span className={`${styles.statusPill} ${styles[tone]}`}>{children}</span>
  );
}

export function Button({
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ParticipantButtonVariant;
}) {
  return (
    <button
      {...props}
      className={`${styles.button} ${styles[variant]} ${props.className ?? ""}`}
    />
  );
}

export function ActionLink({
  href,
  variant = "primary",
  children,
}: {
  href: string;
  variant?: ParticipantButtonVariant;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${styles.linkButton} ${styles[variant]}`}>
      {children}
    </Link>
  );
}

export function MetricCell({
  value,
  label,
}: {
  value: string | number;
  label: string;
}) {
  return (
    <div className={styles.metric}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function FactualChip({ children }: { children: ReactNode }) {
  return <span className={styles.chip}>{children}</span>;
}

export function VerificationBadge({ label }: { label: string }) {
  return (
    <span className={styles.verification}>
      <span className={styles.verificationMark} aria-hidden="true">
        ✓
      </span>
      {label}
    </span>
  );
}

export function ConfirmedJobHero({
  assignment,
  locale = "en-ZA",
}: {
  assignment: Extract<WorkerAssignmentCardModel, { state: "travel_ready" }>;
  locale?: ParticipantLocale;
}) {
  const dictionary = getParticipantDictionary(locale);
  return (
    <section className={styles.hero} aria-labelledby="confirmed-job-title">
      <div className={styles.row}>
        <StatusPill tone="confirmed">
          {dictionary["assignment.confirmed.title"]}
        </StatusPill>
        <strong>{assignment.facts.dateLabel}</strong>
      </div>
      <h2 id="confirmed-job-title">{assignment.facts.workType}</h2>
      <p className={styles.muted}>
        {assignment.facts.contractorName} · {assignment.facts.areaLabel}
      </p>
      <div className={styles.facts}>
        <div>
          <span className={styles.factLabel}>
            {dictionary["fact.startTime"]}
          </span>
          <strong>{assignment.facts.startTimeLabel}</strong>
        </div>
        <div>
          <span className={styles.factLabel}>{dictionary["fact.rate"]}</span>
          <strong>{assignment.facts.rateLabel}</strong>
        </div>
        <div>
          <span className={styles.factLabel}>
            {dictionary["fact.reportingPoint"]}
          </span>
          <strong>{assignment.facts.reportingPoint}</strong>
        </div>
        <div>
          <span className={styles.factLabel}>{dictionary["fact.travel"]}</span>
          <strong>{assignment.facts.travelDetail}</strong>
        </div>
      </div>
      <p>
        <strong>{dictionary["assignment.confirmed.travelReady"]}.</strong>
      </p>
      <div className={styles.actions}>
        <Button>
          <span aria-hidden="true">→</span>{" "}
          {dictionary["assignment.confirmed.onMyWay"]}
        </Button>
        {assignment.directionsUrl ? (
          <ActionLink href={assignment.directionsUrl} variant="secondary">
            <span aria-hidden="true">⌖</span>{" "}
            {dictionary["assignment.confirmed.directions"]}
          </ActionLink>
        ) : null}
        <ReadAloudButton
          assignment={assignment}
          locale={locale}
          label={dictionary["action.listen"]}
        />
      </div>
    </section>
  );
}

type OfferModel = Extract<
  WorkerAssignmentCardModel,
  { state: "offer" | "accepted_waiting" }
>;

export function WorkOfferCard({
  assignment,
  locale = "en-ZA",
  onAccept,
  onDecline,
}: {
  assignment: OfferModel;
  locale?: ParticipantLocale;
  onAccept?: () => void;
  onDecline?: () => void;
}) {
  const dictionary = getParticipantDictionary(locale);
  const offered = assignment.state === "offer";
  return (
    <article className={styles.card}>
      <div className={styles.row}>
        <StatusPill tone={offered ? "neutral" : "warning"}>
          {
            dictionary[
              offered ? "assignment.offer.title" : "assignment.accepted.title"
            ]
          }
        </StatusPill>
        <strong>{assignment.facts.dateLabel}</strong>
      </div>
      <h2>{assignment.facts.workType}</h2>
      <p>
        {assignment.facts.contractorName} · {assignment.facts.areaLabel}
      </p>
      <div className={styles.facts}>
        <div>
          <span className={styles.factLabel}>
            {dictionary["fact.startTime"]}
          </span>
          <strong>{assignment.facts.startTimeLabel}</strong>
        </div>
        <div>
          <span className={styles.factLabel}>{dictionary["fact.rate"]}</span>
          <strong>{assignment.facts.rateLabel}</strong>
        </div>
      </div>
      <p className={styles.warningText}>
        {
          dictionary[
            offered
              ? "assignment.offer.doNotTravel"
              : "assignment.accepted.doNotTravel"
          ]
        }
      </p>
      {offered && (onAccept || onDecline) ? (
        <div className={styles.actions}>
          {onAccept ? (
            <Button onClick={onAccept}>
              <span aria-hidden="true">✓</span>{" "}
              {dictionary["assignment.offer.takeJob"]}
            </Button>
          ) : null}
          {onDecline ? (
            <Button variant="secondary" onClick={onDecline}>
              <span aria-hidden="true">×</span>{" "}
              {dictionary["assignment.offer.cantGo"]}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className={styles.muted}>
          {dictionary["assignment.accepted.waiting"]}
        </p>
      )}
      <ReadAloudButton
        assignment={assignment}
        locale={locale}
        label={dictionary["assignment.offer.listen"]}
      />
    </article>
  );
}

export function WorkCard({ model }: { model: WorkCardPresentationModel }) {
  return (
    <article className={styles.card}>
      <div className={styles.row}>
        <div className={styles.identity}>
          <span className={styles.avatar}>
            {model.displayName
              .split(/\s+/)
              .map((part) => part[0])
              .join("")
              .slice(0, 2)}
          </span>
          <div>
            <h2>{model.displayName}</h2>
            <p className={styles.muted}>{model.primaryWorkCategory}</p>
          </div>
        </div>
        <VerificationBadge label="Verified" />
      </div>
      <div className={styles.metrics}>
        <MetricCell
          value={model.confirmedWorkmarkCount}
          label="confirmed Workmarks"
        />
        <MetricCell
          value={model.repeatContractorCount}
          label="repeat contractors"
        />
        <MetricCell value={model.recentActivityLabel} label="recent activity" />
      </div>
      <div className={styles.chips}>
        {model.skills.map((skill) => (
          <FactualChip key={skill.label}>{skill.label}</FactualChip>
        ))}
      </div>
    </article>
  );
}

export function WorkerMiniCard({
  worker,
  onHireAgain,
}: {
  worker: ContractorWorkerPresentationModel;
  onHireAgain?: () => void;
}) {
  return (
    <article className={`${styles.card} ${styles.workerCard}`}>
      <span className={styles.avatar}>
        {worker.displayName
          .split(/\s+/)
          .map((part) => part[0])
          .join("")
          .slice(0, 2)}
      </span>
      <div className={styles.workerCardBody}>
        <h3>{worker.displayName}</h3>
        <p className={styles.muted}>
          {worker.primaryWorkCategory} · {worker.confirmedWorkmarkCount}{" "}
          Workmarks
        </p>
        <FactualChip>
          {worker.relationship === "repeat"
            ? "Repeat worker"
            : worker.relationship === "known"
              ? "Known worker"
              : "New worker"}
        </FactualChip>
        {onHireAgain ? (
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onHireAgain}>
              <span aria-hidden="true">↻</span> Hire again
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function StaffingProgressRow({
  confirmed,
  required,
  label,
}: {
  confirmed: number;
  required: number;
  label: string;
}) {
  const percent =
    required === 0
      ? 0
      : Math.min(100, Math.round((confirmed / required) * 100));
  return (
    <div>
      <div className={styles.staffingHeader}>
        <strong>{label}</strong>
        <strong>
          {confirmed}/{required}
        </strong>
      </div>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-valuenow={confirmed}
        aria-valuemin={0}
        aria-valuemax={required}
      >
        <div className={styles.progressFill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function FilterChips({
  items,
  active,
}: {
  items: readonly { href: string; label: string }[];
  active: string;
}) {
  return (
    <div className={styles.filters}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`${styles.filterChip} ${item.label === active ? styles.filterActive : ""}`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

export function SettingsRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className={styles.settingsRow}>
      <strong>{label}</strong>
      <span className={styles.muted}>{value}</span>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={styles.empty}>
      <h2>{title}</h2>
      <div className={styles.muted}>{children}</div>
      {action ? <div className={styles.actions}>{action}</div> : null}
    </section>
  );
}

export function ConnectivityState({
  degraded = false,
}: {
  degraded?: boolean;
}) {
  return (
    <aside className={styles.connectivity} role="status">
      <strong>{degraded ? "Connection is unstable" : "You are offline"}</strong>
      <p className={styles.muted}>
        Current job details are not stored for offline use. Check WhatsApp or
        contact the MARKD operator before travelling.
      </p>
    </aside>
  );
}

export function ParticipantShell({
  children,
  navItems,
  navLabel,
  connected = true,
  activeHref,
}: {
  children: ReactNode;
  navItems: readonly ParticipantNavItem[];
  navLabel: string;
  connected?: boolean;
  activeHref?: string;
}) {
  return (
    <div className={styles.app}>
      <ParticipantAppBar connected={connected} />
      <main className={styles.content}>{children}</main>
      <BottomNav
        items={navItems}
        label={navLabel}
        {...(activeHref ? { activeHref } : {})}
      />
    </div>
  );
}

export const participantStyles = styles;

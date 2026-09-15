"use client";

import { useState } from "react";

import {
  ActionLink,
  EmptyState,
  FactualChip,
  ParticipantShell,
  StaffingProgressRow,
  StatusPill,
  WorkerMiniCard,
  participantStyles as styles,
  type ParticipantNavItem,
} from "../../../../components/participant";
import type { ParticipantFixtures } from "../../../../lib/participant/fixtures";
import type { ContractorView } from "../preview-query";

const nav: readonly ParticipantNavItem[] = [
  {
    href: "/participant/preview/contractor?view=home",
    label: "Home",
    icon: "⌂",
  },
  {
    href: "/participant/preview/contractor?view=hire",
    label: "Hire",
    icon: "+",
  },
  {
    href: "/participant/preview/contractor?view=workers",
    label: "Workers",
    icon: "◇",
  },
  {
    href: "/participant/preview/contractor?view=jobs",
    label: "Jobs",
    icon: "▣",
  },
];

export default function ContractorPreview({
  fixtures,
  initialView,
}: {
  fixtures: ParticipantFixtures;
  initialView: ContractorView;
}) {
  const [notice, setNotice] = useState("");
  const contractor = fixtures.contractor;
  const activeHref = `/participant/preview/contractor?view=${initialView === "empty" ? "home" : initialView}`;
  const title =
    initialView === "home" || initialView === "empty"
      ? "Is your crew ready?"
      : initialView === "hire"
        ? "Fill the crew"
        : initialView === "workers"
          ? "Known workers"
          : "Jobs";
  return (
    <ParticipantShell
      navItems={nav}
      navLabel="Contractor preview navigation"
      activeHref={activeHref}
    >
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>
          Synthetic contractor preview · {contractor.displayName}
        </p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.lede}>
          Known and repeat workers are shown before the broader eligible pool.
        </p>
      </header>
      {initialView === "empty" ? (
        <EmptyState title="No open jobs">
          <p>
            Create the next request with your MARKD operator by WhatsApp or
            phone.
          </p>
          <ActionLink href="/participant/preview/contractor?view=hire">
            ＋ Preview hire
          </ActionLink>
        </EmptyState>
      ) : null}
      {initialView === "home" ? (
        <>
          <section className={styles.hero}>
            <div className={styles.row}>
              <StatusPill tone="warning">Thursday crew</StatusPill>
              <strong>Urgent gap</strong>
            </div>
            <h2>{contractor.crew.siteLabel}</h2>
            <p className={styles.muted}>{contractor.crew.dateLabel}</p>
            <StaffingProgressRow
              confirmed={contractor.crew.confirmedWorkerCount}
              required={contractor.crew.requiredWorkerCount}
              label="Crew ready"
            />
            <div className={styles.chips}>
              <FactualChip>2 general labourers</FactualChip>
              <FactualChip>06:30 start</FactualChip>
              <FactualChip>Safety boots required</FactualChip>
            </div>
            <div className={styles.actions}>
              <ActionLink href="/participant/preview/contractor?view=hire">
                ＋ Find 2 workers
              </ActionLink>
            </div>
          </section>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <h2>Known workers</h2>
              <ActionLink
                href="/participant/preview/contractor?view=workers"
                variant="ghost"
              >
                View all →
              </ActionLink>
            </div>
            <div className={styles.workerList}>
              {contractor.workers.map((worker) => (
                <WorkerMiniCard worker={worker} key={worker.workerId} />
              ))}
            </div>
          </section>
        </>
      ) : null}
      {initialView === "hire" ? (
        <>
          <section className={styles.card}>
            <h2>Requirements</h2>
            <div className={styles.chips}>
              <FactualChip>2 open positions</FactualChip>
              <FactualChip>General labour</FactualChip>
              <FactualChip>Bellville South</FactualChip>
              <FactualChip>Urgent</FactualChip>
            </div>
            <p className={styles.warningText}>
              This preview does not send a hiring request. Contact the operator
              to confirm.
            </p>
          </section>
          <section className={styles.section}>
            <h2>Repeat and known workers first</h2>
            <div className={styles.workerList}>
              {contractor.workers.map((worker) => (
                <WorkerMiniCard
                  worker={worker}
                  key={worker.workerId}
                  onHireAgain={() =>
                    setNotice(
                      `${worker.displayName} selected for demo only. Nothing was sent.`,
                    )
                  }
                />
              ))}
            </div>
            <p role="status">{notice}</p>
          </section>
        </>
      ) : null}
      {initialView === "workers" ? (
        <section className={styles.workerList}>
          {contractor.workers.map((worker) => (
            <WorkerMiniCard worker={worker} key={worker.workerId} />
          ))}
        </section>
      ) : null}
      {initialView === "jobs" ? (
        <section className={styles.stack}>
          <article className={styles.card}>
            <div className={styles.row}>
              <div>
                <h2>Riverside site</h2>
                <p className={styles.muted}>12 confirmed Workmarks</p>
              </div>
              <StatusPill tone="confirmed">Completed</StatusPill>
            </div>
          </article>
          <article className={styles.card}>
            <div className={styles.row}>
              <div>
                <h2>Oak Avenue renovation</h2>
                <p className={styles.muted}>6 confirmed Workmarks</p>
              </div>
              <StatusPill tone="confirmed">Completed</StatusPill>
            </div>
          </article>
          <ActionLink
            href="/participant/preview/contractor?view=empty"
            variant="ghost"
          >
            View empty state
          </ActionLink>
        </section>
      ) : null}
    </ParticipantShell>
  );
}

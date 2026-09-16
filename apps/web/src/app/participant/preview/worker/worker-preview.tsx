"use client";

import { useState } from "react";

import {
  CancelledAssignmentCard,
  ConfirmedJobHero,
  ConnectivityState,
  EmptyState,
  FilterChips,
  ParticipantShell,
  SettingsRow,
  StampConfirmation,
  WorkCard,
  WorkOfferCard,
  participantStyles as styles,
  type ParticipantNavItem,
} from "../../../../components/participant";
import type { ParticipantFixtures } from "../../../../lib/participant/fixtures";
import type { WorkerAssignmentCardModel } from "../../../../lib/participant/types";
import {
  workerScenarios,
  type WorkerScenario,
  type WorkerView,
} from "../preview-query";

const nav: readonly ParticipantNavItem[] = [
  { href: "/participant/preview/worker?view=home", label: "Home", icon: "⌂" },
  { href: "/participant/preview/worker?view=work", label: "Work", icon: "▣" },
  {
    href: "/participant/preview/worker?view=card",
    label: "My Card",
    icon: "◇",
  },
  {
    href: "/participant/preview/worker?view=profile",
    label: "Profile",
    icon: "●",
  },
];

function assignmentFor(
  fixtures: ParticipantFixtures,
  scenario: WorkerScenario,
) {
  const state = scenario === "travel_ready" ? "travel_ready" : scenario;
  return fixtures.assignments.find((assignment) => assignment.state === state);
}

export default function WorkerPreview({
  fixtures,
  initialView,
  initialScenario,
}: {
  fixtures: ParticipantFixtures;
  initialView: WorkerView;
  initialScenario: WorkerScenario;
}) {
  const [accepted, setAccepted] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [callRequested, setCallRequested] = useState(false);
  const assignment = assignmentFor(fixtures, initialScenario);
  let displayedAssignment: WorkerAssignmentCardModel | undefined = assignment;
  if (accepted && assignment?.state === "offer") {
    displayedAssignment = {
      ...assignment,
      state: "accepted_waiting",
      status: "accepted_waiting",
      responseState: "accepted",
    };
  }
  if (declined && assignment?.state === "offer") {
    displayedAssignment = {
      ...assignment,
      state: "cancelled",
      status: "cancelled",
      travelState: "do_not_travel",
      cancellationLabel: "You said you cannot go.",
    };
  }

  const scenarioItems = workerScenarios.map((scenario) => ({
    href: `/participant/preview/worker?view=home&scenario=${scenario}`,
    label: scenario.replaceAll("_", " "),
  }));
  const activeHref = `/participant/preview/worker?view=${initialView}`;

  return (
    <ParticipantShell
      navItems={nav}
      navLabel="Worker preview navigation"
      activeHref={activeHref}
      connected={initialScenario !== "degraded"}
    >
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Synthetic worker preview</p>
        <h1 className={styles.title}>
          {initialView === "home"
            ? "Do I have work today?"
            : initialView === "work"
              ? "Work"
              : initialView === "card"
                ? "My Work Card"
                : "Profile"}
        </h1>
        <p className={styles.lede}>
          Preview data only. Confirmations and changes still happen through
          MARKD and WhatsApp.
        </p>
      </header>
      {initialView === "home" ? (
        <>
          <FilterChips
            items={scenarioItems}
            active={initialScenario.replaceAll("_", " ")}
          />
          <section className={styles.section}>
            {initialScenario === "no-work" ? (
              <EmptyState title="No work today">
                <p>
                  Keep WhatsApp available. Your operator will contact you when
                  work is offered.
                </p>
              </EmptyState>
            ) : null}
            {initialScenario === "completed" ? (
              <StampConfirmation>
                Work completed. A Workmark is awaiting the normal evidence and
                confirmation process.
              </StampConfirmation>
            ) : null}
            {initialScenario === "degraded" ? (
              <ConnectivityState degraded />
            ) : null}
            {displayedAssignment?.state === "travel_ready" ? (
              <ConfirmedJobHero assignment={displayedAssignment} />
            ) : null}
            {displayedAssignment?.state === "offer" ? (
              <WorkOfferCard
                assignment={displayedAssignment}
                onAccept={() => setAccepted(true)}
                onDecline={() => setDeclined(true)}
                onRequestCall={() => setCallRequested(true)}
              />
            ) : null}
            {displayedAssignment?.state === "accepted_waiting" ? (
              <WorkOfferCard assignment={displayedAssignment} />
            ) : null}
            {displayedAssignment?.state === "cancelled" ? (
              <CancelledAssignmentCard assignment={displayedAssignment} />
            ) : null}
            {callRequested && displayedAssignment?.state === "offer" ? (
              <p className={styles.muted} role="status">
                MARKD will call you.
              </p>
            ) : null}
          </section>
        </>
      ) : null}
      {initialView === "work" ? (
        <section className={`${styles.section} ${styles.stack}`}>
          {fixtures.assignments.map((item) =>
            item.state === "travel_ready" ? (
              <ConfirmedJobHero key={item.assignmentId} assignment={item} />
            ) : item.state === "offer" || item.state === "accepted_waiting" ? (
              <WorkOfferCard key={item.assignmentId} assignment={item} />
            ) : item.state === "cancelled" ? (
              <CancelledAssignmentCard
                key={item.assignmentId}
                assignment={item}
              />
            ) : null,
          )}
        </section>
      ) : null}
      {initialView === "card" ? <WorkCard model={fixtures.workerCard} /> : null}
      {initialView === "profile" ? (
        <section className={styles.card}>
          <SettingsRow label="Language" value="English" />
          <SettingsRow label="Read aloud" value="On" />
          <SettingsRow label="WhatsApp" value="Primary contact channel" />
          <SettingsRow
            label="Travel preferences"
            value="Cape Town northern suburbs"
          />
        </section>
      ) : null}
    </ParticipantShell>
  );
}

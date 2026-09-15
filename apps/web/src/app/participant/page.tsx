import { redirect } from "next/navigation";

import {
  ActionLink,
  ParticipantAppBar,
  participantStyles as styles,
} from "../../components/participant";
import { requireParticipantSession } from "../../lib/participant/auth";

export default async function ParticipantPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const session = await requireParticipantSession();
  const { reason } = await searchParams;
  if (session.scopes.length === 1 && reason !== "scope") {
    redirect(`/participant/${session.scopes[0]?.kind}`);
  }

  return (
    <div className={styles.app}>
      <ParticipantAppBar />
      <main className={styles.content}>
        <header className={styles.pageHeader}>
          <p className={styles.eyebrow}>Participant access</p>
          <h1 className={styles.title}>
            {session.scopes.length ? "Choose your view" : "Access unavailable"}
          </h1>
          <p className={styles.lede}>
            {session.scopes.length
              ? "Choose the scope you need for this visit."
              : "Your account has no active worker or contractor scope. Contact your MARKD operator."}
          </p>
        </header>
        {session.scopes.length ? (
          <div className={styles.stack}>
            {session.scopes.map((scope, index) => (
              <ActionLink
                key={`${scope.kind}-${index}`}
                href={`/participant/${scope.kind}`}
                variant={index === 0 ? "primary" : "secondary"}
              >
                {scope.kind === "worker"
                  ? "Open worker view"
                  : "Open contractor view"}
              </ActionLink>
            ))}
          </div>
        ) : null}
      </main>
    </div>
  );
}

import type { ReactNode } from "react";

import { ParticipantShell } from "../../../components/participant";
import { requireParticipantScope } from "../../../lib/participant/auth";
import { getWorkerNavigation } from "../../../lib/participant/navigation";

export default async function WorkerLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireParticipantScope("worker");
  return (
    <ParticipantShell
      navItems={getWorkerNavigation()}
      navLabel="Worker navigation"
    >
      {children}
    </ParticipantShell>
  );
}

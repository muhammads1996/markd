import type { ReactNode } from "react";

import { ParticipantShell } from "../../../components/participant";
import { requireParticipantScope } from "../../../lib/participant/auth";
import { getContractorNavigation } from "../../../lib/participant/navigation";

export default async function ContractorLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireParticipantScope("contractor");
  return (
    <ParticipantShell
      navItems={getContractorNavigation()}
      navLabel="Contractor navigation"
    >
      {children}
    </ParticipantShell>
  );
}

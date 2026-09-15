import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { assertParticipantFixturesAllowed } from "../../../lib/participant/fixture-guard";

export const dynamic = "force-dynamic";

export default function ParticipantPreviewLayout({
  children,
}: {
  children: ReactNode;
}) {
  try {
    assertParticipantFixturesAllowed();
  } catch {
    notFound();
  }
  return children;
}

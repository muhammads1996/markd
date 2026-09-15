import type { Metadata } from "next";

import ParticipantShell from "./participant-shell";

export const metadata: Metadata = {
  title: "MARKD | Worker home",
  description: "Your confirmed work and portable Work Card.",
};

export default function ParticipantPage() {
  return <ParticipantShell role="worker" />;
}
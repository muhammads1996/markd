import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { ParticipantServiceWorkerRegistration } from "../../components/participant";

export const metadata: Metadata = {
  title: "MARKD",
  description: "Confirmed work and a portable Work Card.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MARKD",
  },
  icons: {
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#111315",
  width: "device-width",
  initialScale: 1,
};

export default function ParticipantLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <ParticipantServiceWorkerRegistration />
      {children}
    </>
  );
}

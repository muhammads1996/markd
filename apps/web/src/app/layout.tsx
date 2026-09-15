import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "@markd/design-tokens/tokens.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "MARKD | Work leaves a mark",
  description: "A portable work identity and confirmed work surface.",
  applicationName: "MARKD",
};

export const viewport: Viewport = {
  themeColor: "#C7F43D",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

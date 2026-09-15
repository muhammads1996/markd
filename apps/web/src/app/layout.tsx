import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./styles.css";

export const metadata: Metadata = {
  title: "MARKD Operator Platform",
  description: "The operator surface for the MARKD Work Graph.",
  applicationName: "MARKD",
};

export const viewport: Viewport = {
  themeColor: "#f2c94c",
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

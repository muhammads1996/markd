import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MARKD Participant",
    short_name: "MARKD",
    description: "Confirmed work and a portable Work Card.",
    start_url: "/participant",
    display: "standalone",
    background_color: "#F2F1EC",
    theme_color: "#C7F43D",
    icons: [
      {
        src: "/markd-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/markd-icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}

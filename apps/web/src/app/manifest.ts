import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MARKD",
    short_name: "MARKD",
    description: "Confirmed work and a portable Work Card.",
    start_url: "/participant",
    scope: "/participant/",
    display: "standalone",
    background_color: "#F2F1EC",
    theme_color: "#C7F43D",
    icons: [
      {
        src: "/markd-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/markd-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/markd-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

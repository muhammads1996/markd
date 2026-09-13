import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MARKD Operator Platform",
    short_name: "MARKD",
    description: "The operator surface for the MARKD Work Graph.",
    start_url: "/",
    display: "standalone",
    background_color: "#11100e",
    theme_color: "#f2c94c",
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

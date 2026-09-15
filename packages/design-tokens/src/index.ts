export const rawColors = {
  obsidian: "#111315",
  ink2: "#171A1D",
  ink3: "#202428",
  signalLime: "#C7F43D",
  limeSoft: "#E8FF9F",
  concrete: "#F2F1EC",
  steel: "#687078",
  white: "#FFFFFF",
  danger: "#FF685F",
} as const;

export const semanticColors = {
  canvas: rawColors.concrete,
  surface: rawColors.white,
  surfaceStrong: rawColors.obsidian,
  surfaceElevatedDark: rawColors.ink2,
  surfaceSecondaryDark: rawColors.ink3,
  text: rawColors.obsidian,
  textMuted: rawColors.steel,
  textInverse: rawColors.white,
  primaryAction: rawColors.signalLime,
  confirmed: rawColors.signalLime,
  verified: rawColors.signalLime,
  positiveSubtle: rawColors.limeSoft,
  destructive: rawColors.danger,
} as const;

export const spacing = {
  none: "0",
  xs: "0.25rem",
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
  xl: "1.5rem",
  "2xl": "2rem",
  "3xl": "3rem",
} as const;

export const radii = {
  xs: "0.25rem",
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1.25rem",
  xl: "1.75rem",
  full: "999px",
} as const;

export const typography = {
  family: '"Sora", ui-sans-serif, system-ui, sans-serif',
  size: {
    xs: "0.75rem",
    sm: "0.875rem",
    base: "1rem",
    lg: "1.25rem",
    xl: "1.75rem",
    display: "2.5rem",
  },
  weight: {
    regular: 400,
    strong: 700,
    heavy: 800,
  },
  lineHeight: {
    tight: 1.1,
    normal: 1.4,
    relaxed: 1.6,
  },
} as const;

export const shadows = {
  subtle: "0 0.25rem 1rem rgb(17 19 21 / 8%)",
  card: "0 1rem 2.5rem rgb(17 19 21 / 18%)",
  overlay: "0 1.5rem 5rem rgb(17 19 21 / 28%)",
} as const;

export const motion = {
  durationFast: "120ms",
  durationBase: "200ms",
  durationSlow: "320ms",
  easingStandard: "cubic-bezier(0.2, 0, 0, 1)",
} as const;

export const touchTargets = {
  minimum: "2.75rem",
  comfortable: "3rem",
  primary: "3.5rem",
} as const;

export const contentWidths = {
  compact: "40rem",
  reading: "48rem",
  app: "74rem",
} as const;

export type RawColorToken = keyof typeof rawColors;
export type SemanticColorToken = keyof typeof semanticColors;
export type SpacingToken = keyof typeof spacing;
export type RadiusToken = keyof typeof radii;

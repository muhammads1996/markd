import { getParticipantDictionary, type ParticipantLocale } from "@markd/i18n";

import type { ParticipantNavItem } from "../../components/participant";

export function getWorkerNavigation(
  locale: ParticipantLocale = "en-ZA",
  base = "/participant/worker",
): ParticipantNavItem[] {
  const dictionary = getParticipantDictionary(locale);
  return [
    { href: base, label: dictionary["nav.home"], icon: "⌂" },
    { href: `${base}/work`, label: dictionary["nav.work"], icon: "▣" },
    { href: `${base}/card`, label: dictionary["nav.myCard"], icon: "◇" },
    { href: `${base}/profile`, label: dictionary["nav.profile"], icon: "●" },
  ];
}

export function getContractorNavigation(
  locale: ParticipantLocale = "en-ZA",
  base = "/participant/contractor",
): ParticipantNavItem[] {
  const dictionary = getParticipantDictionary(locale);
  return [
    { href: base, label: dictionary["nav.home"], icon: "⌂" },
    { href: `${base}/hire`, label: dictionary["nav.hire"], icon: "+" },
    { href: `${base}/workers`, label: dictionary["nav.workers"], icon: "◇" },
    { href: `${base}/jobs`, label: dictionary["nav.jobs"], icon: "▣" },
  ];
}

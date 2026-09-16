export const participantLanguageCodes = ["en", "af", "xh"] as const;
export type ParticipantLanguageCode = (typeof participantLanguageCodes)[number];

export const participantLocales = ["en-ZA", "af-ZA", "xh-ZA"] as const;
export type ParticipantLocale = (typeof participantLocales)[number];

export const participantLocaleByLanguage = {
  en: "en-ZA",
  af: "af-ZA",
  xh: "xh-ZA",
} as const satisfies Record<ParticipantLanguageCode, ParticipantLocale>;

export const participantLanguageByLocale = {
  "en-ZA": "en",
  "af-ZA": "af",
  "xh-ZA": "xh",
} as const satisfies Record<ParticipantLocale, ParticipantLanguageCode>;

export const participantMessageKeys = [
  "connection.connected",
  "nav.home",
  "nav.work",
  "nav.myCard",
  "nav.profile",
  "nav.hire",
  "nav.workers",
  "nav.jobs",
  "status.offer",
  "status.acceptedWaiting",
  "status.confirmedTravelReady",
  "status.cancelled",
  "travel.doNotTravel",
  "travel.doNotTravelYet",
  "travel.travelReady",
  "action.takeJob",
  "action.cannotGo",
  "action.listen",
  "action.onMyWay",
  "action.directions",
  "action.requestCall",
  "fact.workType",
  "fact.contractor",
  "fact.date",
  "fact.startTime",
  "fact.rate",
  "fact.area",
  "fact.reportingPoint",
  "fact.travel",
  "fact.contact",
  "workCard.title",
  "workCard.confirmedWorkmarks",
  "workCard.repeatContractors",
  "workCard.recentActivity",
  "contractor.crewReady",
  "contractor.workersStillNeeded",
  "assignment.offer.title",
  "assignment.offer.doNotTravel",
  "assignment.offer.takeJob",
  "assignment.offer.cantGo",
  "assignment.offer.callMe",
  "assignment.offer.listen",
  "assignment.offer.question",
  "assignment.offer.replyTake",
  "assignment.offer.replyDecline",
  "assignment.offer.replyCall",
  "assignment.offer.voiceNote",
  "assignment.offer.callRequested",
  "assignment.accepted.title",
  "assignment.accepted.waiting",
  "assignment.accepted.doNotTravel",
  "assignment.accepted.confirmation",
  "assignment.confirmed.title",
  "assignment.confirmed.travelReady",
  "assignment.confirmed.go",
  "assignment.confirmed.onMyWay",
  "assignment.confirmed.directions",
  "assignment.changed",
  "assignment.cancelled",
  "assignment.cancelled.doNotTravel",
  "workCard.workmarks",
  "workCard.demonstratedSkills",
  "workCard.verified",
  "contractor.openPositions",
  "contractor.hireAgain",
  "contractor.knownWorker",
  "profile.language",
  "profile.readAloud",
  "profile.whatsapp",
  "profile.travelPreferences",
  "common.loading",
  "common.offline",
  "common.tryAgain",
  "common.close",
] as const;

export type ParticipantMessageKey = (typeof participantMessageKeys)[number];
export type ParticipantDictionary = Readonly<
  Record<ParticipantMessageKey, string>
>;

export const participantDictionaries = {
  en: {
    "connection.connected": "Connected",
    "nav.home": "Home",
    "nav.work": "Work",
    "nav.myCard": "My Card",
    "nav.profile": "Profile",
    "nav.hire": "Hire",
    "nav.workers": "Workers",
    "nav.jobs": "Jobs",
    "status.offer": "WORK OFFER",
    "status.acceptedWaiting": "ACCEPTED - WAITING FOR CONFIRMATION",
    "status.confirmedTravelReady": "WORK CONFIRMED",
    "status.cancelled": "WORK CANCELLED",
    "travel.doNotTravel": "DO NOT TRAVEL",
    "travel.doNotTravelYet": "DO NOT TRAVEL YET",
    "travel.travelReady": "YOU CAN TRAVEL. THIS JOB IS CONFIRMED.",
    "action.takeJob": "TAKE JOB",
    "action.cannotGo": "CAN'T GO",
    "action.listen": "LISTEN",
    "action.onMyWay": "I'M ON MY WAY",
    "action.directions": "DIRECTIONS",
    "action.requestCall": "CALL ME",
    "fact.workType": "Work",
    "fact.contractor": "Contractor",
    "fact.date": "Date",
    "fact.startTime": "Start time",
    "fact.rate": "Rate",
    "fact.area": "Area",
    "fact.reportingPoint": "Reporting point",
    "fact.travel": "Travel",
    "fact.contact": "Contact",
    "workCard.title": "Your Work Card",
    "workCard.confirmedWorkmarks": "confirmed Workmarks",
    "workCard.repeatContractors": "repeat contractors",
    "workCard.recentActivity": "recent activity",
    "contractor.crewReady": "Is your crew ready?",
    "contractor.workersStillNeeded": "workers still needed",
    "assignment.offer.title": "Work offer",
    "assignment.offer.doNotTravel": "Do not travel yet",
    "assignment.offer.takeJob": "Take job",
    "assignment.offer.cantGo": "Can't go",
    "assignment.offer.callMe": "Call me",
    "assignment.offer.listen": "Listen",
    "assignment.offer.question": "Can you take this job?",
    "assignment.offer.replyTake": "Reply YES or 1 to take this job.",
    "assignment.offer.replyDecline": "Reply NO or 2 if you cannot go.",
    "assignment.offer.replyCall": "Reply 3 if you want a call.",
    "assignment.offer.voiceNote": "You can also send a voice note.",
    "assignment.offer.callRequested": "MARKD will call you.",
    "assignment.accepted.title": "Offer accepted",
    "assignment.accepted.waiting": "Waiting for contractor confirmation",
    "assignment.accepted.doNotTravel": "Do not travel yet",
    "assignment.accepted.confirmation":
      "We will tell you when work is confirmed.",
    "assignment.confirmed.title": "Work confirmed",
    "assignment.confirmed.travelReady": "You can travel",
    "assignment.confirmed.go": "GO",
    "assignment.confirmed.onMyWay": "I'm on my way",
    "assignment.confirmed.directions": "Directions",
    "assignment.changed": "Work details changed",
    "assignment.cancelled": "Work cancelled",
    "assignment.cancelled.doNotTravel":
      "Do not travel. This work is cancelled.",
    "workCard.workmarks": "Workmarks",
    "workCard.demonstratedSkills": "Demonstrated skills",
    "workCard.verified": "Verified evidence",
    "contractor.openPositions": "Open positions",
    "contractor.hireAgain": "Hire again",
    "contractor.knownWorker": "Known worker",
    "profile.language": "Language",
    "profile.readAloud": "Read aloud",
    "profile.whatsapp": "WhatsApp support",
    "profile.travelPreferences": "Travel preferences",
    "common.loading": "Loading",
    "common.offline": "You are offline",
    "common.tryAgain": "Try again",
    "common.close": "Close",
  },
  af: {
    "connection.connected": "Gekoppel",
    "nav.home": "Tuis",
    "nav.work": "Werk",
    "nav.myCard": "My Kaart",
    "nav.profile": "Profiel",
    "nav.hire": "Huur",
    "nav.workers": "Werkers",
    "nav.jobs": "Werke",
    "status.offer": "WERKSAANBOD",
    "status.acceptedWaiting": "AANVAAR - WAG VIR BEVESTIGING",
    "status.confirmedTravelReady": "WERK BEVESTIG",
    "status.cancelled": "WERK GEKANSELLEER",
    "travel.doNotTravel": "MOENIE REIS NIE",
    "travel.doNotTravelYet": "MOENIE NOG REIS NIE",
    "travel.travelReady": "JY KAN REIS. HIERDIE WERK IS BEVESTIG.",
    "action.takeJob": "VAT DIE WERK",
    "action.cannotGo": "KAN NIE GAAN NIE",
    "action.listen": "LUISTER",
    "action.onMyWay": "EK IS OP PAD",
    "action.directions": "AANWYSINGS",
    "action.requestCall": "BEL MY",
    "fact.workType": "Werk",
    "fact.contractor": "Kontrakteur",
    "fact.date": "Datum",
    "fact.startTime": "Begintyd",
    "fact.rate": "Tarief",
    "fact.area": "Gebied",
    "fact.reportingPoint": "Aanmeldpunt",
    "fact.travel": "Reis",
    "fact.contact": "Kontak",
    "workCard.title": "Jou Werkkaart",
    "workCard.confirmedWorkmarks": "bevestigde Workmarks",
    "workCard.repeatContractors": "herhaalde kontrakteurs",
    "workCard.recentActivity": "onlangse aktiwiteit",
    "contractor.crewReady": "Is jou span gereed?",
    "contractor.workersStillNeeded": "werkers nog nodig",
    "assignment.offer.title": "Werksaanbod",
    "assignment.offer.doNotTravel": "Moenie nog reis nie",
    "assignment.offer.takeJob": "Vat die werk",
    "assignment.offer.cantGo": "Kan nie gaan nie",
    "assignment.offer.callMe": "Bel my",
    "assignment.offer.listen": "Luister",
    "assignment.offer.question": "Kan jy hierdie werk vat?",
    "assignment.offer.replyTake": "Antwoord JA of 1 om die werk te vat.",
    "assignment.offer.replyDecline":
      "Antwoord NEE of 2 as jy nie kan gaan nie.",
    "assignment.offer.replyCall": "Antwoord 3 as jy 'n oproep wil he.",
    "assignment.offer.voiceNote": "Jy kan ook 'n stemboodskap stuur.",
    "assignment.offer.callRequested": "MARKD sal jou bel.",
    "assignment.accepted.title": "Aanbod aanvaar",
    "assignment.accepted.waiting": "Wag vir kontrakteurbevestiging",
    "assignment.accepted.doNotTravel": "Moenie nog reis nie",
    "assignment.accepted.confirmation":
      "Ons sal jou laat weet wanneer werk bevestig is.",
    "assignment.confirmed.title": "Werk bevestig",
    "assignment.confirmed.travelReady": "Jy kan reis",
    "assignment.confirmed.go": "GAAN",
    "assignment.confirmed.onMyWay": "Ek is op pad",
    "assignment.confirmed.directions": "Aanwysings",
    "assignment.changed": "Werkbesonderhede het verander",
    "assignment.cancelled": "Werk gekanselleer",
    "assignment.cancelled.doNotTravel":
      "Moenie reis nie. Hierdie werk is gekanselleer.",
    "workCard.workmarks": "Workmarks",
    "workCard.demonstratedSkills": "Bewese vaardighede",
    "workCard.verified": "Geverifieerde bewyse",
    "contractor.openPositions": "Oop poste",
    "contractor.hireAgain": "Huur weer",
    "contractor.knownWorker": "Bekende werker",
    "profile.language": "Taal",
    "profile.readAloud": "Lees hardop",
    "profile.whatsapp": "WhatsApp-ondersteuning",
    "profile.travelPreferences": "Reisvoorkeure",
    "common.loading": "Laai tans",
    "common.offline": "Jy is vanlyn",
    "common.tryAgain": "Probeer weer",
    "common.close": "Sluit",
  },
  xh: {
    "connection.connected": "Uqhagamshelwe",
    "nav.home": "Ekhaya",
    "nav.work": "Umsebenzi",
    "nav.myCard": "Ikhadi Lam",
    "nav.profile": "Iprofayile",
    "nav.hire": "Qesha",
    "nav.workers": "Abasebenzi",
    "nav.jobs": "Imisebenzi",
    "status.offer": "ISINIKEZELO SOMSEBENZI",
    "status.acceptedWaiting": "YAMKELWE - KUSALINDWE ISIQINISEKISO",
    "status.confirmedTravelReady": "UMSEBENZI UQINISEKISIWE",
    "status.cancelled": "UMSEBENZI URHOXISIWE",
    "travel.doNotTravel": "MUSA UKUHAMBA",
    "travel.doNotTravelYet": "MUSA UKUHAMBA OKWANGOKU",
    "travel.travelReady": "UNGANGENA ENDLELENI. LO MSEBENZI UQINISEKISIWE.",
    "action.takeJob": "WAMKELE UMSEBENZI",
    "action.cannotGo": "ANDINAKUYA",
    "action.listen": "MAMELA",
    "action.onMyWay": "NDISENDLELENI",
    "action.directions": "IZIKHOKELO",
    "action.requestCall": "NDIFOWUNELE",
    "fact.workType": "Umsebenzi",
    "fact.contractor": "Ikontraka",
    "fact.date": "Umhla",
    "fact.startTime": "Ixesha lokuqala",
    "fact.rate": "Intlawulo",
    "fact.area": "Indawo",
    "fact.reportingPoint": "Indawo yokufika",
    "fact.travel": "Uhambo",
    "fact.contact": "Umntu woqhagamshelwano",
    "workCard.title": "Ikhadi Lakho Lomsebenzi",
    "workCard.confirmedWorkmarks": "ii-Workmark eziqinisekisiweyo",
    "workCard.repeatContractors": "iikontraka eziphindayo",
    "workCard.recentActivity": "umsebenzi wakutshanje",
    "contractor.crewReady": "Iqela lakho lilungile?",
    "contractor.workersStillNeeded": "abasebenzi abasafunekayo",
    "assignment.offer.title": "Isinikezelo somsebenzi",
    "assignment.offer.doNotTravel": "Musa ukuhamba okwangoku",
    "assignment.offer.takeJob": "Wamkele umsebenzi",
    "assignment.offer.cantGo": "Andinakukwazi ukuya",
    "assignment.offer.callMe": "Ndifowunele",
    "assignment.offer.listen": "Mamela",
    "assignment.offer.question": "Ungawamkela lo msebenzi?",
    "assignment.offer.replyTake":
      "Phendula EWE okanye 1 ukuze wamkele umsebenzi.",
    "assignment.offer.replyDecline": "Phendula HAYI okanye 2 xa ungenakuya.",
    "assignment.offer.replyCall": "Phendula 3 ukuba ufuna ukufowunelwa.",
    "assignment.offer.voiceNote": "Ungathumela nenowuthi yelizwi.",
    "assignment.offer.callRequested": "UMARKD uza kukufowunela.",
    "assignment.accepted.title": "Isinikezelo samkelwe",
    "assignment.accepted.waiting": "Kulindwe isiqinisekiso sekontraka",
    "assignment.accepted.doNotTravel": "Musa ukuhamba okwangoku",
    "assignment.accepted.confirmation":
      "Siza kukuxelela xa umsebenzi uqinisekisiwe.",
    "assignment.confirmed.title": "Umsebenzi uqinisekisiwe",
    "assignment.confirmed.travelReady": "Ungahamba",
    "assignment.confirmed.go": "HAMBA",
    "assignment.confirmed.onMyWay": "Ndisendleleni",
    "assignment.confirmed.directions": "Izikhokelo",
    "assignment.changed": "Iinkcukacha zomsebenzi zitshintshile",
    "assignment.cancelled": "Umsebenzi urhoxisiwe",
    "assignment.cancelled.doNotTravel":
      "Musa ukuhamba. Lo msebenzi urhoxisiwe.",
    "workCard.workmarks": "Ii-Workmark",
    "workCard.demonstratedSkills": "Izakhono ezibonisiweyo",
    "workCard.verified": "Ubungqina obuqinisekisiweyo",
    "contractor.openPositions": "Izithuba ezivulekileyo",
    "contractor.hireAgain": "Qesha kwakhona",
    "contractor.knownWorker": "Umsebenzi owaziwayo",
    "profile.language": "Ulwimi",
    "profile.readAloud": "Funda ngokuvakalayo",
    "profile.whatsapp": "Inkxaso ka-WhatsApp",
    "profile.travelPreferences": "Ukhetho lokuhamba",
    "common.loading": "Iyalayisha",
    "common.offline": "Awukho kwi-intanethi",
    "common.tryAgain": "Zama kwakhona",
    "common.close": "Vala",
  },
} as const satisfies Record<ParticipantLanguageCode, ParticipantDictionary>;

export function getParticipantDictionary(
  locale: ParticipantLocale,
): ParticipantDictionary {
  return participantDictionaries[participantLanguageByLocale[locale]];
}

export type WorkerAssignmentMessageState =
  "offer" | "accepted_waiting" | "confirmed_travel_ready" | "cancelled";

export interface WorkerAssignmentMessageFacts {
  workType?: string;
  contractorName?: string;
  dateLabel?: string;
  startTimeLabel?: string;
  rateLabel?: string;
  areaLabel?: string;
  reportingPoint?: string;
  travelDetail?: string;
  contactLabel?: string;
  cancellationLabel?: string;
}

export type WorkerAssignmentResponse = "accepted" | "declined" | "call_me";

const workerResponseByWhatsAppReply: Readonly<
  Record<string, WorkerAssignmentResponse>
> = {
  YES: "accepted",
  "1": "accepted",
  NO: "declined",
  "2": "declined",
  "3": "call_me",
};

export function parseWorkerAssignmentWhatsAppResponse(
  reply: string,
): WorkerAssignmentResponse | null {
  return workerResponseByWhatsAppReply[reply.trim().toUpperCase()] ?? null;
}

function formatWorkerAssignmentFacts(
  dictionary: ParticipantDictionary,
  facts: WorkerAssignmentMessageFacts,
  fields: readonly (readonly [ParticipantMessageKey, string | undefined])[],
): string[] {
  return fields.flatMap(([label, value]) =>
    value?.trim() ? [`${dictionary[label]}: ${value.trim()}`] : [],
  );
}

export function formatWorkerAssignmentMessage(
  state: WorkerAssignmentMessageState,
  facts: WorkerAssignmentMessageFacts,
  locale: ParticipantLocale,
): string {
  const dictionary = getParticipantDictionary(locale);
  const commonFacts = formatWorkerAssignmentFacts(dictionary, facts, [
    ["fact.workType", facts.workType],
    ["fact.contractor", facts.contractorName],
    ["fact.date", facts.dateLabel],
    ["fact.startTime", facts.startTimeLabel],
    ["fact.rate", facts.rateLabel],
    ["fact.area", facts.areaLabel],
  ]);
  const confirmedFacts = formatWorkerAssignmentFacts(dictionary, facts, [
    ["fact.reportingPoint", facts.reportingPoint],
    ["fact.travel", facts.travelDetail],
    ["fact.contact", facts.contactLabel],
  ]);

  if (state === "offer") {
    return [
      `${dictionary["status.offer"]} - ${dictionary["travel.doNotTravelYet"]}`,
      ...commonFacts,
      dictionary["assignment.offer.question"],
      dictionary["assignment.offer.replyTake"],
      dictionary["assignment.offer.replyDecline"],
      dictionary["assignment.offer.replyCall"],
      dictionary["assignment.offer.voiceNote"],
    ].join("\n");
  }

  if (state === "accepted_waiting") {
    return [
      `${dictionary["status.acceptedWaiting"]} - ${dictionary["travel.doNotTravelYet"]}`,
      ...commonFacts,
      dictionary["assignment.accepted.waiting"],
      dictionary["assignment.accepted.confirmation"],
    ].join("\n");
  }

  if (state === "confirmed_travel_ready") {
    return [
      `${dictionary["status.confirmedTravelReady"]} - ${dictionary["assignment.confirmed.go"]}`,
      ...commonFacts,
      ...confirmedFacts,
      dictionary["travel.travelReady"],
    ].join("\n");
  }

  return [
    dictionary["status.cancelled"],
    facts.cancellationLabel?.trim(),
    dictionary["assignment.cancelled.doNotTravel"],
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

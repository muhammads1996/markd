import { test as base, expect } from "@playwright/test";

import { ContractorProfilePage } from "../pages/contractor-profile-page";
import { OnboardingPage } from "../pages/onboarding-page";
import { OperatorPage } from "../pages/operator-page";
import { ParticipantPage } from "../pages/participant-page";
import { SearchPage } from "../pages/search-page";
import { SignInPage } from "../pages/sign-in-page";
import { WorkerProfilePage } from "../pages/worker-profile-page";
import { provisionOperatorUser, removeOperatorUser } from "./operator-db";
import {
  provisionParticipantUser,
  provisionParticipantWorkerAssignment,
  removeParticipantUser,
  removeParticipantWorkerAssignment,
  type ParticipantAssignmentFixture,
} from "./participant-db";
import {
  buildOperatorUser,
  buildParticipantUser,
  type OperatorUserFixtureData,
  type ParticipantUserFixtureData,
} from "./test-data";

type Fixtures = {
  operatorUser: OperatorUserFixtureData;
  loggedInAsOperator: OperatorUserFixtureData;
  signInPage: SignInPage;
  operatorPage: OperatorPage;
  onboardingPage: OnboardingPage;
  searchPage: SearchPage;
  workerProfilePage: WorkerProfilePage;
  contractorProfilePage: ContractorProfilePage;
  participantPage: ParticipantPage;
  participantUser: ParticipantUserFixtureData;
  participantAssignment: ParticipantAssignmentFixture;
  loggedInAsParticipant: ParticipantUserFixtureData;
};

export const test = base.extend<Fixtures>({
  // Provisions a randomly generated operator account before the test and
  // removes it afterwards so local Supabase auth/operator_accounts tables
  // don't accumulate test users.
  operatorUser: async ({}, use) => {
    const user = buildOperatorUser();
    await provisionOperatorUser(user);
    try {
      await use(user);
    } finally {
      await removeOperatorUser(user.id);
    }
  },

  signInPage: async ({ page }, use) => {
    await use(new SignInPage(page));
  },
  operatorPage: async ({ page }, use) => {
    await use(new OperatorPage(page));
  },
  onboardingPage: async ({ page }, use) => {
    await use(new OnboardingPage(page));
  },
  searchPage: async ({ page }, use) => {
    await use(new SearchPage(page));
  },
  workerProfilePage: async ({ page }, use) => {
    await use(new WorkerProfilePage(page));
  },
  contractorProfilePage: async ({ page }, use) => {
    await use(new ContractorProfilePage(page));
  },
  participantPage: async ({ page }, use) => {
    await use(new ParticipantPage(page));
  },
  participantUser: async ({}, use) => {
    const user = buildParticipantUser();
    await provisionParticipantUser(user);
    try {
      await use(user);
    } finally {
      await removeParticipantUser(user);
    }
  },
  participantAssignment: async ({ participantUser }, use) => {
    const assignment =
      await provisionParticipantWorkerAssignment(participantUser);
    try {
      await use(assignment);
    } finally {
      await removeParticipantWorkerAssignment(participantUser, assignment);
    }
  },

  // Depends on operatorUser for setup/teardown and signs the page in via the
  // real sign-in form, landing on /operator before the test body runs.
  loggedInAsOperator: async ({ operatorUser, signInPage }, use) => {
    await signInPage.goto();
    await signInPage.signInAndWaitForOperatorHome(
      operatorUser.email,
      operatorUser.password,
    );
    await use(operatorUser);
  },
  loggedInAsParticipant: async ({ participantUser, signInPage, page }, use) => {
    await signInPage.goto();
    await signInPage.signIn(participantUser.email, participantUser.password);
    await page.waitForLoadState("networkidle");
    await use(participantUser);
  },
});

export { expect };

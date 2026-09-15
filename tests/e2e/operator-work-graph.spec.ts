import { expectNoHorizontalOverflow } from "./support/assertions";
import { expect, test } from "./support/fixtures";

test("supports phone-sized onboarding, search, editing, and relationship history", async ({
  page,
  loggedInAsOperator,
  onboardingPage,
  searchPage,
  workerProfilePage,
  contractorProfilePage,
}) => {
  await expect(page).toHaveURL(/\/operator$/);
  expect(loggedInAsOperator.role).toBe("ops_user");

  await onboardingPage.goto();
  await expect(onboardingPage.addHeading).toBeVisible();
  await expect(onboardingPage.preferredNameInput).toBeVisible();
  await expect(onboardingPage.communicationPreferenceInput).toBeVisible();
  await expect(onboardingPage.optionalParticipationText).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await onboardingPage.goto("10000000-0000-4000-8000-000000000001");
  await expect(onboardingPage.updateHeading).toBeVisible();
  await expect(onboardingPage.preferredNameInput).toHaveValue("Anele Sample");
  await expectNoHorizontalOverflow(page);

  await searchPage.goto("+27 82 000 0002");
  await expect(
    searchPage.resultText("Example Build", { exact: true }),
  ).toBeVisible();
  await expect(searchPage.resultText("+27820000002")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await workerProfilePage.goto("10000000-0000-4000-8000-000000000001");
  await expect(workerProfilePage.markdArrangedWorkText).toBeVisible();
  await expect(workerProfilePage.demonstratedSkillsHeading).toBeVisible();
  await expect(workerProfilePage.confirmedWorkmarkEvidenceText).toBeVisible();
  await expect(workerProfilePage.editWorkerLink).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await workerProfilePage.goto("10000000-0000-4000-8000-000000000003");
  await expect(workerProfilePage.historicalClaimText).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await contractorProfilePage.goto("20000000-0000-4000-8000-000000000001");
  await expect(contractorProfilePage.knownLabourNetworkHeading).toBeVisible();
  await expect(contractorProfilePage.editContractorLink).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

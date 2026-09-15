import { expect, test } from "./support/fixtures";

test("a mapped worker can enter only the worker participant scope", async ({
  loggedInAsParticipant,
  participantPage,
  page,
}) => {
  expect(loggedInAsParticipant.scope).toBe("worker");
  await participantPage.gotoWorker();
  await expect(participantPage.heading).toHaveText("Your work");
  await expect(participantPage.navigation).toHaveAttribute(
    "aria-label",
    "Worker navigation",
  );

  await participantPage.gotoContractor();
  await expect(page).toHaveURL(/\/participant(?:\?reason=scope)?$/);
});

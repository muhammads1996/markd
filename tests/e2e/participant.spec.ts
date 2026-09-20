import { expect, test } from "./support/fixtures";
import { readAssignmentCloseoutState } from "./support/participant-db";

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

test("a worker closes assigned work into one canonical Stamp and Workmark", async ({
  loggedInAsParticipant,
  page,
  participantAssignment,
  participantPage,
}) => {
  expect(loggedInAsParticipant.scope).toBe("worker");
  await participantPage.gotoWorker();
  await expect(
    page.getByRole("heading", { name: "Playwright closeout work" }),
  ).toBeVisible();

  await page.getByLabel("Work together again").selectOption("yes");
  await page.getByLabel("Payment state").selectOption("paid");
  await page.getByLabel("Payment amount (minor units)").fill("12500");
  await page.getByLabel("Payment method").fill("cash");
  await page.getByLabel("Note").fill("Completed through the worker PWA.");

  const [closeoutResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response
        .url()
        .includes(
          `/api/v1/assignments/${participantAssignment.assignmentId}/stamps`,
        ),
    ),
    page.getByRole("button", { name: "Stamp work" }).click(),
  ]);
  expect(closeoutResponse.status()).toBe(201);

  await expect
    .poll(() => readAssignmentCloseoutState(participantAssignment.assignmentId))
    .toMatchObject({
      stampCount: 1,
      workmarkCount: 1,
      workmarkAssignmentId: participantAssignment.assignmentId,
      workmarkWorkerId: loggedInAsParticipant.personId,
      stampAssignmentId: participantAssignment.assignmentId,
      stampWorkerId: loggedInAsParticipant.personId,
    });
});

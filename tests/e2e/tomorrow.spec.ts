import { expect, test } from "./support/fixtures";
import {
  provisionTomorrowScenario,
  removeTomorrowScenario,
} from "./support/tomorrow-db";
import { expectNoHorizontalOverflow } from "./support/assertions";

test("Tomorrow reconciles headcount, assignment states, delivery and exceptions", async ({
  page,
  loggedInAsOperator,
}, testInfo) => {
  const fixture = await provisionTomorrowScenario(
    loggedInAsOperator.id,
    testInfo.project.name === "mobile-chromium" ? 2 : 1,
  );
  try {
    await page.goto(`/operator/tomorrow?date=${fixture.date}`);

    await expect(
      page.getByRole("heading", { name: "Tomorrow", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(fixture.date, { exact: true })).toBeVisible();

    const summary = page.getByRole("region", {
      name: "Tomorrow operational summary",
    });
    await expect(summary).toContainText("4positions required");
    await expect(summary).toContainText("1travel ready");
    await expect(summary).toContainText("1exceptions");
    await expect(summary).toContainText("1logistics gaps");

    const request = page
      .getByRole("region", { name: "Tomorrow labour requests" })
      .getByRole("article");
    await expect(
      request.getByRole("heading", { name: "Tomorrow Fixture Build" }),
    ).toBeVisible();
    await expect(request).toContainText("Plastering");
    await expect(request).toContainText("3 covered / 4 required");
    await expect(request).toContainText("1 open");

    const accepted = request.locator('[data-state="accepted_waiting"]').first();
    await expect(accepted).toContainText("Mina Accepted");
    await expect(accepted).toContainText("ACCEPTED · DO NOT TRAVEL");
    await expect(accepted).not.toContainText("Authorised to travel");
    const ready = request.locator('[data-state="travel_ready"]');
    await expect(
      ready.getByRole("link", {
        name: "Open exception: verification trust concern",
      }),
    ).toHaveAttribute(
      "href",
      `/operator/exceptions#case-${fixture.exceptionId}`,
    );

    await expect(ready).toContainText("Sizwe Travel Ready");
    await expect(ready).toContainText(
      "Authorised to travel to pickup: Bellville Library",
    );
    await expect(ready).toContainText("WhatsApp failed");

    const offered = request.locator('[data-state="awaiting_worker_response"]');
    await expect(offered).toContainText("Aphiwe Offered");
    await expect(offered).toContainText("OFFER SENT · WAITING");

    // Exercise the same canonical commands used by the operator surface.
    await accepted.getByRole("button", { name: "Confirm assignment" }).click();
    await expect(
      accepted.getByRole("button", { name: "Confirm assignment" }),
    ).toHaveCount(0);
    const logistics = accepted.getByText("Set logistics");
    await logistics.click();
    await accepted
      .getByLabel("Site or pickup location")
      .fill("Synthetic North Gate");
    await accepted.getByLabel("Reporting time").fill(`${fixture.date}T06:30`);
    await accepted.getByRole("button", { name: "Save logistics" }).click();
    const refreshedAccepted = page
      .locator('[data-state="accepted_waiting"]')
      .filter({
        hasText: "Mina Accepted",
      });
    await expect(
      refreshedAccepted.getByRole("button", { name: "Authorise travel" }),
    ).toBeVisible();
    await refreshedAccepted
      .getByRole("button", { name: "Authorise travel" })
      .click();
    const transitioned = page.locator('[data-state="travel_ready"]').filter({
      hasText: "Mina Accepted",
    });
    await expect(transitioned).toContainText("TRAVEL READY");
    await expect(transitioned).toContainText(
      "Authorised to travel to site: Synthetic North Gate",
    );

    await expectNoHorizontalOverflow(page);
  } finally {
    await removeTomorrowScenario(fixture);
  }
});

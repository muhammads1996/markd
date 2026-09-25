import { expectNoHorizontalOverflow } from "./support/assertions";
import { expect, test } from "./support/fixtures";
import {
  provisionPendingInboxItem,
  removePendingInboxItem,
} from "./support/operator-db";

test("keeps operator navigation and Inbox review controls usable", async ({
  page,
  loggedInAsOperator,
}) => {
  expect(loggedInAsOperator.role).toBe("ops_user");

  const mobile = (page.viewportSize()?.width ?? 0) < 960;
  const navigation = page.getByRole("navigation", {
    name: mobile ? "Operator navigation" : "Primary navigation",
  });

  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Today" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await skipLink.focus();
  await skipLink.press("Enter");
  await expect(page.locator("#operator-content")).toBeFocused();

  const inboxItem = await provisionPendingInboxItem();
  try {
    await page.goto("/operator/inbox");

    await expect(
      navigation.getByRole("link", { name: "Inbox" }),
    ).toHaveAttribute("aria-current", "page");

    const itemCard = page
      .getByRole("article", { name: "Proposed propose_workmark" })
      .filter({ hasText: inboxItem.originalText });
    await expect(itemCard).toBeVisible();
    await expect(
      itemCard.getByRole("button", { name: "Confirm" }),
    ).toBeVisible();
    await expect(itemCard.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(
      itemCard.getByRole("button", { name: "Reject" }),
    ).toBeVisible();
    await expect(itemCard.getByRole("button", { name: "Defer" })).toHaveCount(
      0,
    );
    await expectNoHorizontalOverflow(page);
  } finally {
    await removePendingInboxItem(inboxItem);
  }
});

test("keeps the private exceptions queue usable on a phone", async ({
  page,
  loggedInAsOperator,
}) => {
  expect(loggedInAsOperator.role).toBe("ops_user");

  await page.goto("/operator/exceptions");

  await expect(page.getByRole("heading", { name: "Exceptions" })).toBeVisible();
  const exception = page.getByRole("article").filter({
    hasText: "Synthetic follow-up",
  });
  await expect(exception.getByText("Synthetic follow-up")).toBeVisible();
  await expect(
    exception.getByRole("heading", { name: "Anele Sample" }),
  ).toBeVisible();
  await expect(
    exception.getByText("Example Build", { exact: true }),
  ).toBeVisible();
  await expect(
    exception.getByRole("heading", { name: "Participant-separated claims" }),
  ).toBeVisible();
  await expect(
    exception.getByRole("heading", { name: "Workmark and Stamp evidence" }),
  ).toBeVisible();
  await expect(
    exception.getByText("Add a participant counterclaim or review note."),
  ).toBeVisible();
  await expect(exception.getByText("Add claim / operator note")).toBeVisible();
  await exception.getByText("Add claim / operator note").click();
  await expect(
    exception.getByRole("button", { name: "Add claim" }),
  ).toBeVisible();
  await expect(exception.getByLabel("Source")).toHaveValue("operator_ui");
  await expect(page.getByText("Open an exception")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

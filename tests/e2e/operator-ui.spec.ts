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

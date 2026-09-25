import { expect, type Page } from "@playwright/test";

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const overflowingElements = Array.from(document.body.querySelectorAll("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className:
            typeof element.className === "string" ? element.className : "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter(({ left, right }) => left < 0 || right > clientWidth)
      .sort((left, right) => right.right - left.right)
      .slice(0, 8);
    return { clientWidth, scrollWidth, overflowingElements };
  });
  expect(
    dimensions.scrollWidth > dimensions.clientWidth,
    JSON.stringify(dimensions, null, 2),
  ).toBe(false);
}

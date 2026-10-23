import { test, expect } from "@playwright/test";
test("evidence → edit → explicit approval → immutable version snapshot → export", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Review findings" }).click();
  await expect(
    page
      .getByRole("button", { name: /Dimensions & scale/ })
      .getByText("3 of 10 imported records"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve this change" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Confirm every edited factual claim",
  );
  await page.locator("#draft").fill("Forma is 28 cm tall and 16 cm wide.");
  await page.getByLabel("I have checked every factual claim").check();
  await page.getByRole("button", { name: "Approve this change" }).click();
  await expect(page.getByRole("status")).toContainText("Version saved");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export safe HTML" }).click();
  expect((await download).suggestedFilename()).toBe("forma-description.html");
  await page
    .getByRole("button", { name: "Changes", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Forma · Version 1" }),
  ).toBeVisible();
});
test("CSV mapping, mixed products, redaction and text deduplication", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await page.getByRole("button", { name: "Add evidence", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "evidence.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "id,type,product,message\nA,Question,forma,How tall is this?\nB,Question,forma,How tall is this?\nC,Support,forma,Email jane@example.com\nD,Review,wall,Wrong product\nE,Review,forma,\n",
    ),
  });
  await page.getByRole("combobox").selectOption("message");
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(
    page.getByText("Email [email redacted]", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Different product: wall — excluded."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import previewed records" }).click();
  await expect(
    page.getByText("12 unique source records", { exact: false }),
  ).toBeVisible();
});
test("conflicting claims block demo approval and mobile has no overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Review findings" }).click();
  await page.locator("#draft").fill("The battery lasts eight hours.");
  await page.getByLabel("I have checked every factual claim").check();
  await page.getByRole("button", { name: "Approve this change" }).click();
  await expect(page.getByRole("status")).toContainText("Resolve the battery");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("deletion produces an honest sparse evidence state", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Delete demo evidence" }).click();
  await page.getByRole("button", { name: "Products", exact: true }).click();
  await page.getByRole("button", { name: "Review findings" }).click();
  await expect(page.getByText("Not enough evidence yet.")).toBeVisible();
});

import { test, expect } from "@playwright/test";
test("authenticated manual product → CSV evidence → cited analysis → approved export survives reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/workspace");
  await page
    .getByRole("button", { name: "Create a local development account" })
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`browser-${Date.now()}@merchant.example`);
  await page
    .getByLabel("Development password")
    .fill("browser-local-password-123");
  await page
    .getByRole("button", { name: "Create local account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Better pages start with listening." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await page
    .getByLabel("Product title", { exact: true })
    .fill("Merchant test lamp");
  await page
    .getByLabel("Current description")
    .fill("A rechargeable lamp for your home.");
  await page
    .getByLabel("Specifications:")
    .fill(
      "size | 28 cm tall and 16 cm wide\npower | Up to four hours at full brightness",
    );
  await page.getByLabel("I have checked these specifications").check();
  await page
    .getByRole("button", { name: "Import product", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Merchant test lamp", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add evidence", exact: true })
    .first()
    .click();
  await page.getByLabel("Upload CSV").setInputFiles({
    name: "test-evidence.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "id,type,product,date,text\n1,Question,,2026-10-01,How tall is this lamp?\n2,Question,,2026-10-02,How wide is the lamp?\n3,Review,,2026-10-03,The battery lasted eight hours\n",
    ),
  });
  await page.getByRole("button", { name: "Preview import" }).click();
  await page.getByLabel("I reviewed the sources").check();
  await page.getByRole("button", { name: "Import reviewed records" }).click();
  await expect(page.getByRole("status")).toContainText("3 records imported");
  await page.reload();
  await page.getByRole("button", { name: "Open product", exact: true }).click();
  await page
    .getByRole("button", { name: "Analyze evidence", exact: true })
    .click();
  await expect(page.getByText("2 of 3 imported records")).toBeVisible({
    timeout: 15000,
  });
  await expect(
    page
      .locator(".source-panel blockquote")
      .filter({ hasText: "How tall is this lamp?" }),
  ).toBeVisible();
  await page
    .getByLabel("Generate from confirmed facts")
    .selectOption("Clarification");
  await page.getByLabel("Edit your draft").fill("28 cm tall and 16 cm wide.");
  await page
    .getByLabel("Record how you verified")
    .fill("Checked dimensions against the approved merchant specification.");
  await page.getByLabel("I verified every factual claim").check();
  await page
    .getByRole("button", { name: "Approve this change", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Exact draft approved");
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await page.getByRole("button", { name: /Merchant test lamp/ }).click();
  await expect(
    page.getByText("28 cm tall and 16 cm wide.", { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export approved HTML" }).click();
  expect((await download).suggestedFilename()).toBe(
    "cluecart-approved-description.html",
  );
  await page.reload();
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await page.getByRole("button", { name: /Merchant test lamp/ }).click();
  await expect(
    page.getByRole("heading", { name: "Approved versions" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/merchant-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/merchant-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  const deletion = await page.request.delete("/api/account", {
    data: { confirmation: "DELETE MY WORKSPACE" },
  });
  expect(deletion.ok()).toBeTruthy();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});

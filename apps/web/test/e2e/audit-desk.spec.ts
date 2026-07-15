import { expect, test } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
});

test("login, queue, evidence and export blocking", async ({ page }) => {
  await page.getByRole("button", { name: "Entra come REVIEWER" }).click();

  await expect(page.getByRole("heading", { name: "Revisione tecnica VERA" })).toBeVisible();
  await expect(page.locator("mark", { hasText: "codice visibile: DEMO-CODE-42" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Esporta audit" })).toBeDisabled();

  await page.getByRole("button", { name: "Salva decisione" }).click();
  await expect(page.getByText("revisionato").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Esporta audit" })).toBeDisabled();
});

test("critical override requires rationale", async ({ page }) => {
  await page.getByRole("button", { name: "Entra come APPROVER" }).click();
  await page.getByLabel("Non applicabile").check();
  await page.getByRole("button", { name: "Salva decisione" }).click();

  await expect(page.getByRole("alert")).toContainText("Motivazione obbligatoria");

  await page.getByLabel(/Motivazione/).fill("Override critico motivato per demo tecnica.");
  await page.getByRole("button", { name: "Salva decisione" }).click();
  await expect(page.getByText("revisionato").first()).toBeVisible();
});

test("optimistic conflict is shown to the reviewer", async ({ page }) => {
  await page.getByRole("button", { name: "Entra come REVIEWER" }).click();
  await page.getByRole("button", { name: "Simula conflitto" }).click();
  await expect(page.getByText(/corrente 2/)).toBeVisible();
  await page.getByRole("button", { name: "Salva decisione" }).click();

  await expect(page.getByRole("alert")).toContainText("modificata da un’altra sessione");
});

test("author role cannot decide", async ({ page }) => {
  await page.getByRole("button", { name: "Entra come AUTHOR" }).click();

  await expect(page.getByText(/può leggere ma non decidere/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Salva decisione" })).toBeDisabled();
});

test("main workflow has no detectable WCAG violations", async ({ page }) => {
  await page.getByRole("button", { name: "Entra come REVIEWER" }).click();

  const results = await new AxeBuilder({ page }).include("main").analyze();
  expect(results.violations).toEqual([]);
});

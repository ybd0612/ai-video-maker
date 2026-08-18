import { test, expect } from "@playwright/test";

test.describe("AI Video Maker - UI Tests", () => {
  test("should load homepage", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/.*ai.video.make.*/i);
  });

  test("should have main layout elements", async ({ page }) => {
    await page.goto("/");
    // Check for key UI elements
    const settingsBtn = page.getByRole("button", { name: /settings/i });
    await expect(settingsBtn).toBeVisible();
  });

  test("settings dialog should show current config", async ({ page }) => {
    await page.goto("/");
    
    // Open settings
    const settingsBtn = page.getByRole("button", { name: /settings/i });
    await settingsBtn.click();
    
    // Check for API key field
    const apiKeyInput = page.getByLabel(/API Key|apiKey/i);
    await expect(apiKeyInput).toBeVisible();
    
    // Check for Base URL field (should be api.agnes-ai.cn/v1)
    const baseUrlInput = page.getByLabel(/Base URL|baseUrl/i);
    await expect(baseUrlInput).toBeVisible();
    
    // Check for plan selector
    const planSelect = page.getByLabel(/plan|套餐/i);
    await expect(planSelect).toBeVisible();
  });

  test("rate limit info should be visible in settings", async ({ page }) => {
    await page.goto("/");
    
    // Open settings
    const settingsBtn = page.getByRole("button", { name: /settings/i });
    await settingsBtn.click();
    
    // Check for RPM info
    const rpmInfo = page.getByText(/RPM|rpm/i);
    await expect(rpmInfo).toBeVisible();
    
    // Check for quota info
    const quotaInfo = page.getByText(/quota|配额/i);
    await expect(quotaInfo).toBeVisible();
  });
});

import { defineConfig, devices } from "@playwright/test";

const API_PORT = 3100;
const WEB_PORT = 4180;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

/**
 * E2E na prawdziwym stosie: Chromium → Vite preview (build produkcyjny frontendu) → API NestJS (dist) → PostgreSQL (baza *_e2e).
 * Scenariusze tożsamości są stanowe (aktywacja administratora, zaproszenia) — projekt „desktop” wykonuje je po kolei,
 * projekt „telefon” (390 px) działa na danych utworzonych przez desktop.
 */
export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : [["list"]],
  outputDir: "test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { baseURL: WEB_URL, locale: "pl-PL", timezoneId: "Europe/Warsaw", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", testMatch: /identity\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "magazyn", testMatch: /stock\.spec\.ts/, dependencies: ["desktop"], use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "kartoteki", testMatch: /catalog\.spec\.ts/, dependencies: ["desktop"], use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "dokumenty", testMatch: /documents\.spec\.ts/, dependencies: ["magazyn", "kartoteki"], use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "telefon", testMatch: /mobile\.spec\.ts/, dependencies: ["desktop"], use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    { command: "node start-api.mjs", url: `http://127.0.0.1:${API_PORT}/api/v1/health`, timeout: 120_000, reuseExistingServer: false, stdout: "pipe", stderr: "pipe",
      env: { E2E_API_PORT: String(API_PORT), E2E_WEB_URL: WEB_URL } },
    { command: "pnpm --filter @resinvest/web exec vite preview --host 127.0.0.1", url: WEB_URL, timeout: 60_000, reuseExistingServer: false,
      env: { API_PROXY: `http://127.0.0.1:${API_PORT}`, WEB_PORT: String(WEB_PORT) } },
  ],
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./src",
  timeout: 30_000,
  retries: 0,
  use: {
    headless: true,
    trace: "retain-on-failure",
  },
});

import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5180",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: [
    {
      command:
        "DEV_AUTH=1 API_PORT=3002 DATABASE_URL=postgresql://cluecart@127.0.0.1:5432/cluecart_e2e tsx server/index.ts",
      url: "http://127.0.0.1:3002/api/health",
      reuseExistingServer: false,
    },
    {
      command:
        "API_TARGET=http://127.0.0.1:3002 npm run dev:web -- --port 5180 --strictPort",
      url: "http://127.0.0.1:5180",
      reuseExistingServer: false,
    },
  ],
  reporter: "list",
});

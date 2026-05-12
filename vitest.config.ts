import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TELEGRAM_BOT_TOKEN: "test-bot-token",
          TELEGRAM_CHANNEL_ID: "@test_channel",
          WEBHOOK_SECRET: "test-secret",
        },
      },
    }),
  ],
});

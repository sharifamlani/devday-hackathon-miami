import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // The parent CRM has its own browser Vitest project. Keep this independent
    // package's jsdom checks out of that runner's default *.test / *.spec glob.
    include: ["tests/**/*.checks.{ts,tsx}"],
  },
});

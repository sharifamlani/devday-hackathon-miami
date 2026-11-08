import path from "node:path";

/** Pure data-contract and server-rendered workspace checks, without browser/model dependencies. */
export default {
  resolve: {
    dedupe: ["react-router", "react-router-dom"],
    preserveSymlinks: true,
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/components/atomic-crm/providers/local/**/*.test.ts",
      "src/components/atomic-crm/home/*.test.ts",
      "src/components/atomic-crm/home/*.render.test.tsx",
      "src/components/atomic-crm/calendar/planLayer.test.ts",
      "src/components/atomic-crm/outreach/outreach.test.ts",
      "src/components/atomic-crm/outreach/usePlan.test.ts",
      "src/components/atomic-crm/layout/shellState.test.ts",
      "api/*.test.ts",
    ],
  },
};

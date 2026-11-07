import { memoryStore } from "ra-core";

import { CallToday } from "../dashboard/CallToday";
import { KindredLandingGate } from "../landing/KindredLanding";
import { authProvider } from "../providers/fakerest";
import { dataProvider } from "../providers/local";
import { CRM } from "./CRM";

/**
 * Donor Desk: the atomic-crm shell configured for the hackathon demo.
 * Used by both entry points (src/App.tsx for `npm run dev`, demo/App.tsx for
 * the Vercel build), so they always render the same app.
 *
 * memoryStore: the configuration (title, logos) is re-seeded on every load,
 * so a stale "Atomic CRM" config in localStorage can't leak onto the stage.
 * The theme starts light to match the Kindred design reference; the header
 * toggle still switches to dark or system for the session.
 */
export const DonorDesk = () => (
  <KindredLandingGate>
    <CRM
      dataProvider={dataProvider}
      authProvider={authProvider}
      store={memoryStore({ theme: "light" })}
      dashboard={CallToday}
      disableTelemetry
    />
  </KindredLandingGate>
);

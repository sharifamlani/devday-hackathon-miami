import { memoryStore } from "ra-core";

import { HomePage } from "../home/HomePage";
import { KindredLandingGate } from "../landing/KindredLanding";
import { authProvider } from "../providers/fakerest";
import { dataProvider } from "../providers/local";
import { CRM } from "./CRM";

/** Donor work, not sales: "thank-you" also marks a donor Thanked once done. */
const donorTaskTypes = [
  { value: "call", label: "Call" },
  { value: "thank-you", label: "Thank you" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "follow-up", label: "Follow-up" },
  { value: "event-invite", label: "Event invite" },
  { value: "visit", label: "Stewardship visit" },
  { value: "none", label: "Other" },
];

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
      dashboard={HomePage}
      taskTypes={donorTaskTypes}
      disableTelemetry
    />
  </KindredLandingGate>
);

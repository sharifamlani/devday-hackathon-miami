import { memoryStore } from "ra-core";

import { authProvider, dataProvider } from "../providers/fakerest";
import { CRM } from "./CRM";

/**
 * Donor Desk: the atomic-crm shell configured for the hackathon demo.
 * Used by both entry points (src/App.tsx for `npm run dev`, demo/App.tsx for
 * the Vercel build), so they always render the same app.
 *
 * memoryStore: the configuration (title, logos) is re-seeded on every load,
 * so a stale "Atomic CRM" config in localStorage can't leak onto the stage.
 */
export const DonorDesk = () => (
  <CRM
    dataProvider={dataProvider}
    authProvider={authProvider}
    store={memoryStore()}
    disableTelemetry
  />
);

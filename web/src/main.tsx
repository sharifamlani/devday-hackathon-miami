import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { applyMotionPreference, readMotionPreference } from "./lib/motion";
import { probeAndFlag } from "./components/atomic-crm/providers/local/apiProbe";

// The saved "Reduce motion" choice, on <html> before anything renders or animates.
applyMotionPreference(readMotionPreference());

// After a new deploy, the service worker may replace its pre-cache while
// the page still holds old chunk references. A reload picks up the new
// HTML + new SW cache. A sessionStorage guard prevents infinite loops.
// See https://vite.dev/guide/build.html#load-error-handling
window.addEventListener("vite:preloadError", () => {
  const key = "chunk-reload";
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, "1");
    window.location.reload();
  }
});

// Local/live builds check the API first (2 s). Unreachable (e.g. the tunnel is off): run on the snapshot.
// App loads after the check because config.ts reads the result once, at import.
const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
probeAndFlag(import.meta.env.VITE_DATA_MODE, apiUrl)
  .then(() => import("./App.tsx"))
  .then(({ default: App }) => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });

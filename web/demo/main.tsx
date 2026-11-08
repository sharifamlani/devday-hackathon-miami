import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import { applyMotionPreference, readMotionPreference } from "../src/lib/motion";
import App from "./App.tsx";

// The saved "Reduce motion" choice, on <html> before anything renders or animates.
applyMotionPreference(readMotionPreference());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

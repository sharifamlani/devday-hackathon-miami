import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DATA_MODE } from "../providers/local";
import "./kindred-landing.css";

const subscribeToHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const getHash = () => window.location.hash;

/** Keep workspace hash routes; the bare app URL is always the landing page. */
export const KindredLandingGate = ({ children }: { children: ReactNode }) => {
  const hash = useSyncExternalStore(subscribeToHash, getHash, () => "");
  if (hash === "#/welcome") return <KindredLanding />;
  if (hash !== "") return children;
  return <KindredLanding />;
};

export const KindredLanding = () => {
  const [areColorsPaused, setColorsPaused] = useState(false);
  const startOnboarding = () => {
    // React Admin uses a hash router. The force flag starts at step one even
    // when this browser completed setup during an earlier demo run.
    window.location.hash = "#/?onboarding=1";
  };

  return (
    <main
      className={`kindred-landing${areColorsPaused ? " colors-paused" : ""}`}
      aria-labelledby="kindred-heading"
    >
      <div className="kindred-landing-content">
        {DATA_MODE === "snapshot" && (
          <div className="fixed right-4 top-4 z-10">
            <Badge
              variant="outline"
              title="Read-only sample export. Not real donor records."
              aria-label="Sample data. Read-only sample export. Not real donor records."
              data-testid="sample-data-badge"
            >
              Sample data
            </Badge>
          </div>
        )}
        <p className="kindred-wordmark">kindred</p>
        <h1 id="kindred-heading" className="kindred-headline">
          <span>Less time on tasks.</span>
          <strong>More time for people.</strong>
        </h1>
        <p className="kindred-subtitle">
          Your mission deserves more of your time.
        </p>
        <button
          className="kindred-upload kindred-start"
          type="button"
          onClick={startOnboarding}
        >
          Get started
        </button>
        <ol className="kindred-steps" aria-label="How Kindred works">
          <li>Upload your list</li>
          <li>Understand your donors</li>
          <li>Reach out thoughtfully</li>
        </ol>
      </div>

      <button
        className="kindred-motion-toggle"
        type="button"
        onClick={() => setColorsPaused((paused) => !paused)}
        aria-pressed={areColorsPaused}
        aria-label="Pause background colors"
      >
        {areColorsPaused ? (
          <Play size={13} aria-hidden="true" />
        ) : (
          <Pause size={13} aria-hidden="true" />
        )}
        {areColorsPaused ? "Resume colors" : "Pause colors"}
      </button>
    </main>
  );
};

import React, { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import { KindredLanding } from "../../src/components/atomic-crm/landing/KindredLanding";
import { UploadProcessing } from "../../src/components/atomic-crm/upload/UploadProcessing";
import { onboardingStore } from "../../src/components/atomic-crm/onboarding/onboardingState";

// Development-only journey. The landing's preview action never reads or sends files.
const sample = {
  people: 78,
  gifts: 131,
  duplicates: 0,
  duplicatesRemoved: 6,
  files: 3,
  byTab: null,
  review: 0,
};
const fixed = new URLSearchParams(location.search).get("state");
type Stage = "landing" | "loading" | "results" | "profile";
const initialStage: Stage =
  fixed === "loading"
    ? "loading"
    : fixed === "complete"
      ? "results"
      : fixed === "organization"
        ? "profile"
        : "landing";
if (initialStage === "profile") {
  onboardingStore.dispatch({ type: "start", step: 1 }, { open: true });
  history.replaceState(null, "", "/#/");
}
const App = lazy(() => import("../../demo/App"));
export const Preview = () => {
  const [stage, setStage] = useState<Stage>(initialStage);
  const [run, setRun] = useState(0);
  const [continuous, setContinuous] = useState(fixed === "loading");
  useEffect(() => {
    if (stage !== "loading" || continuous) return;
    const timer = window.setTimeout(() => setStage("results"), 12000);
    return () => window.clearTimeout(timer);
  }, [stage, run, continuous]);
  const begin = () => {
    setContinuous(false);
    setRun((value) => value + 1);
    setStage("loading");
  };
  const profile = () => {
    onboardingStore.dispatch({ type: "update", patch: { files: sample } });
    onboardingStore.dispatch({ type: "start", step: 1 }, { open: true });
    history.replaceState(null, "", "/#/");
    setStage("profile");
  };
  return (
    <>
      {stage === "profile" ? (
        <Suspense fallback={null}>
          <App />
        </Suspense>
      ) : stage === "landing" ? (
        <KindredLanding onPreviewUpload={begin} />
      ) : (
        <UploadProcessing
          key={run}
          demo
          pending={stage === "loading"}
          summary={stage === "results" ? sample : null}
          onContinue={profile}
        />
      )}
      {(stage === "landing" || stage === "profile") && (
        <p
          style={{
            position: "fixed",
            top: 15,
            right: 20,
            zIndex: 60,
            margin: 0,
            fontSize: 10,
            color: "#72786e",
          }}
        >
          Design preview · sample data · no files sent
        </p>
      )}
      <nav
        aria-label="Preview controls"
        style={{
          position: "fixed",
          bottom: 16,
          left: 0,
          right: 0,
          zIndex: 60,
          display: "flex",
          justifyContent: "center",
          gap: 20,
          fontFamily: "inherit",
          fontSize: 11,
          color: "#6b7265",
        }}
      >
        <button
          onClick={() => {
            history.replaceState(null, "", "/design/upload-flow/index.html");
            setStage("landing");
          }}
        >
          Start over
        </button>
        {stage !== "profile" && (
          <button onClick={begin}>Replay animation</button>
        )}
        {(stage === "loading" || stage === "results") && (
          <button onClick={() => setStage("results")}>Show completion</button>
        )}
      </nav>
    </>
  );
};
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);

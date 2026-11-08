import React, { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import { UploadProcessing } from "../../src/components/atomic-crm/upload/UploadProcessing";
import { onboardingStore } from "../../src/components/atomic-crm/onboarding/onboardingState";

// Development-only visual harness. No file is transmitted and these results are explicitly samples.
const sample = {
  people: 78,
  gifts: 131,
  duplicates: 0,
  duplicatesRemoved: 6,
  files: 3,
  byTab: null,
  review: 0,
};
const params = new URLSearchParams(location.search);
const fixed = params.get("state");
const App = lazy(() => import("../../demo/App"));
export const Preview = () => {
  const [profile, setProfile] = useState(false);
  const [run, setRun] = useState(0);
  const [done, setDone] = useState(fixed === "complete");
  useEffect(() => {
    if (fixed) return;
    setDone(false);
    const timer = window.setTimeout(() => setDone(true), 18000);
    return () => window.clearTimeout(timer);
  }, [run]);
  if (profile)
    return (
      <Suspense fallback={null}>
        <App />
      </Suspense>
    );
  return (
    <>
      <UploadProcessing
        key={run}
        demo
        pending={!done}
        summary={done ? sample : null}
        onContinue={() => {
          onboardingStore.dispatch({ type: "start", step: 1 }, { open: true });
          history.replaceState(null, "", "/#/");
          setProfile(true);
        }}
      />
      <div
        style={{
          position: "fixed",
          bottom: 18,
          left: 0,
          right: 0,
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
            setDone(false);
            setRun((value) => value + 1);
          }}
        >
          Replay animation
        </button>
        <button onClick={() => setDone(true)}>Show completion</button>
        <a href="/#/welcome">Landing page</a>
      </div>
    </>
  );
};
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);

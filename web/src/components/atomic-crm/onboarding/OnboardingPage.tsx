import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import { HOME } from "../home/homePath";
import { openLanding } from "../landing/KindredLanding";
import { DATA_MODE } from "../providers/local";
import { UploadProcessing } from "../upload/UploadProcessing";
import { readOrganizationInBackground } from "./backgroundRead";
import { StepsScreen } from "./OnboardingFlow";
import { OrganizationStep } from "./OnboardingSteps";
import { useOnboarding } from "./onboardingState";
import { useServiceHasPeople } from "./useServiceHasPeople";
import "./onboarding.css";

/**
 * #/onboarding (docs/plans/user-journey.md §7.2): the organization card as its own page, between the
 * landing's import and the dashboard. Continue starts the research in the background (the same call the
 * setup overlay made) and opens #/dashboard at once; Finish later opens it without the research. Back
 * shows the import's receipt again. With no import saved and no people in the service, there is nothing
 * to set up yet, so it returns to the landing.
 */
export const OnboardingPage = () => {
  const { data, update, finish, finishLater } = useOnboarding();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hasPeople = useServiceHasPeople();
  const [busy, setBusy] = useState(false);
  const onBusy = useCallback((value: boolean) => setBusy(value), []);
  const [receipt, setReceipt] = useState(false);

  const nothingToSetUp =
    DATA_MODE === "local" && !data.files && hasPeople === false;
  useEffect(() => {
    if (nothingToSetUp) openLanding({ replace: true });
  }, [nothingToSetUp]);

  const later = () => {
    finishLater();
    navigate(HOME);
  };

  if (nothingToSetUp) return null;
  if (receipt && data.files)
    return (
      <UploadProcessing
        pending={false}
        summary={data.files}
        onContinue={() => setReceipt(false)}
        onReviewDuplicates={() => {
          // Setup waits; "Restart onboarding" in the account menu comes back here.
          finishLater();
          navigate("/contacts");
        }}
      />
    );
  return (
    <StepsScreen
      step={1}
      busy={busy}
      onBack={() => (data.files ? setReceipt(true) : openLanding())}
      onEscape={later}
    >
      {(headingRef) => (
        <OrganizationStep
          headingRef={headingRef}
          onBusy={onBusy}
          onFinishLater={later}
          onContinue={(links) => {
            update({ links, linksSavedTo: "local", tourOffer: "dismissed" });
            void readOrganizationInBackground(links).finally(() =>
              queryClient.invalidateQueries(),
            );
            finish();
            navigate(HOME);
          }}
        />
      )}
    </StepsScreen>
  );
};

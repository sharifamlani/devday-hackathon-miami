import { useEffect } from "react";
import { useLocation } from "react-router";

import { OnboardingFlow } from "./OnboardingFlow";
import {
  readOnboardingParam,
  shouldAutoShow,
  shouldOfferTour,
  useOnboarding,
} from "./onboardingState";
import { TourOffer } from "./TourOffer";
import { TourRunner } from "./TourRunner";

/**
 * Mount once in the layout. Opens first-run setup on the first visit to the
 * homepage ("/") for someone new, or when `?onboarding=1` is in the URL
 * (demos; `?onboarding=0` keeps it closed). It fires at most once per page
 * load, so closing the flow never reopens it by itself. The flag lives at
 * module level because react-admin can remount the layout (and this gate)
 * while it settles its routes. After setup, the dashboard offers the tour.
 */
let firedThisPageLoad = false;

export const OnboardingGate = () => {
  const { open, tour, data, start } = useOnboarding();
  const { pathname, search } = useLocation();
  const param = readOnboardingParam(
    typeof window === "undefined" ? "" : window.location.search,
    (typeof window === "undefined" ? "" : window.location.hash) || search,
  );

  useEffect(() => {
    if (open || tour || firedThisPageLoad) return;
    if (!shouldAutoShow(data, pathname, param)) return;
    firedThisPageLoad = true;
    // A demo always starts at step 1; otherwise resume where they left off.
    start(param === "force" ? 0 : data.step);
  }, [open, tour, data, pathname, param, start]);

  if (open) return <OnboardingFlow />;
  if (tour) return <TourRunner />;
  if (shouldOfferTour(data, pathname, param)) return <TourOffer />;
  return null;
};

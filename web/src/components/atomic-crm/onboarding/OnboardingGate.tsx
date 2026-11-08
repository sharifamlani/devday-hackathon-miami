import { useEffect, useState } from "react";
import { useLocation } from "react-router";

import { DATA_MODE, donorDeskMethods } from "../providers/local";
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

/**
 * Live mode: does the service already have people? null while asking. Setup is remembered only in this
 * browser's localStorage, so a new browser (or incognito) on a filled service would otherwise get
 * step 1 over a working dashboard. Snapshot mode: always false, so nothing changes there.
 */
const useServiceHasPeople = (): boolean | null => {
  const [hasPeople, setHasPeople] = useState<boolean | null>(DATA_MODE === "local" ? null : false);
  useEffect(() => {
    if (DATA_MODE !== "local") return;
    let live = true;
    donorDeskMethods
      .getDonors()
      .then((donors) => live && setHasPeople(donors.length > 0))
      .catch(() => live && setHasPeople(false));
    return () => {
      live = false;
    };
  }, []);
  return hasPeople;
};

export const OnboardingGate = () => {
  const { open, tour, data, start, adopt } = useOnboarding();
  const hasPeople = useServiceHasPeople();
  const { pathname, search } = useLocation();
  const param = readOnboardingParam(
    typeof window === "undefined" ? "" : window.location.search,
    (typeof window === "undefined" ? "" : window.location.hash) || search,
  );

  useEffect(() => {
    if (open || tour || firedThisPageLoad) return;
    if (!shouldAutoShow(data, pathname, param)) return;
    if (param !== "force") {
      if (hasPeople === null) return; // still asking the service
      if (hasPeople) {
        adopt(); // set up already (another browser): done here too, no overlay
        return;
      }
    }
    firedThisPageLoad = true;
    // A demo always starts at step 1; otherwise resume where they left off.
    start(param === "force" ? 0 : data.step);
  }, [open, tour, data, pathname, param, start, hasPeople, adopt]);

  if (open) return <OnboardingFlow />;
  if (tour) return <TourRunner />;
  if (shouldOfferTour(data, pathname, param)) return <TourOffer />;
  return null;
};

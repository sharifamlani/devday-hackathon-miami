import { useEffect } from "react";
import { useLocation } from "react-router";

import { isHomePath } from "../home/homePath";
import { openLanding } from "../landing/KindredLanding";
import { DATA_MODE } from "../providers/local";
import { useBackgroundWatcher } from "./backgroundRead";
import { OnboardingFlow } from "./OnboardingFlow";
import {
  readOnboardingParam,
  shouldAdopt,
  shouldOfferTour,
  shouldShowBackground,
  useOnboarding,
} from "./onboardingState";
import { TourOffer } from "./TourOffer";
import { TourRunner } from "./TourRunner";
import { useServiceHasPeople } from "./useServiceHasPeople";

/**
 * Mount once in the layout. Setup has its own page now (docs/plans/user-journey.md §3): the journey is the
 * landing (bare URL) → #/onboarding → #/dashboard, so this gate never opens setup over the dashboard by
 * itself. An empty app's dashboard goes back to the landing (live mode), and so does `?onboarding=1`
 * (demos). A new browser on a filled service adopts setup as done. After setup, the dashboard offers the
 * tour, and a slow website read keeps a status line until it's done.
 */
export const OnboardingGate = () => {
  const { open, tour, data, adopt } = useOnboarding();
  const hasPeople = useServiceHasPeople();
  const { pathname, search } = useLocation();
  const param = readOnboardingParam(
    typeof window === "undefined" ? "" : window.location.search,
    (typeof window === "undefined" ? "" : window.location.hash) || search,
  );
  useBackgroundWatcher(data.background?.status === "running");

  useEffect(() => {
    if (!isHomePath(pathname)) return; // deep links (#/contacts …) always open
    if (param === "force") return openLanding({ replace: true });
    if (DATA_MODE !== "local" || hasPeople === null) return; // still asking the service
    if (!hasPeople) return openLanding({ replace: true }); // nothing to show yet: start the journey
    if (shouldAdopt(data, hasPeople)) adopt(); // set up already (another browser): done here too
  }, [pathname, param, hasPeople, data, adopt]);

  if (open) return <OnboardingFlow />;
  if (tour) return <TourRunner />;
  const offer = shouldOfferTour(data, pathname, param);
  if (offer || shouldShowBackground(data, param))
    return <TourOffer offer={offer} />;
  return null;
};

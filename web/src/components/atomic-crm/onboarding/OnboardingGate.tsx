import { useEffect } from "react";
import { useLocation } from "react-router";

import { OnboardingFlow } from "./OnboardingFlow";
import {
  readOnboardingParam,
  shouldAutoShow,
  useOnboarding,
} from "./onboardingState";

/**
 * Mount once in the layout. Opens the onboarding flow on the first visit to
 * the homepage ("/") for someone new, or when `?onboarding=1` is in the URL
 * (demos; `?onboarding=0` keeps it closed). It fires at most once per page
 * load, so closing the flow never reopens it by itself. The flag lives at
 * module level because react-admin can remount the layout (and this gate)
 * while it settles its routes.
 */
let firedThisPageLoad = false;

export const OnboardingGate = () => {
  const { open, data, start } = useOnboarding();
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (open || firedThisPageLoad) return;
    const param = readOnboardingParam(
      window.location.search,
      window.location.hash || search,
    );
    if (!shouldAutoShow(data, pathname, param)) return;
    firedThisPageLoad = true;
    // A demo always starts at Welcome; otherwise resume where they left off.
    start(param === "force" ? 0 : data.step);
  }, [open, data, pathname, search, start]);

  return open ? <OnboardingFlow /> : null;
};

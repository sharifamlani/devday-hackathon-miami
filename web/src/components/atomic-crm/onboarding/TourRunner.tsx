import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { CoachMarks } from "./CoachMarks";
import { useOnboarding } from "./onboardingState";
import {
  TOUR_STOPS,
  availableStops,
  tourSelector,
  type TourStop,
} from "./tour";
import { HOME, isHomePath } from "../home/homePath";
import "./onboarding.css";

const findTarget = (id: TourStop["id"]) =>
  document.querySelector(tourSelector(id));

/**
 * The optional homepage tour: goes to the dashboard, waits for its parts to
 * render, then runs the coach marks over the ones on screen. Esc, Skip or
 * Done ends it.
 */
export const TourRunner = () => {
  const { endTour } = useOnboarding();
  const location = useLocation();
  const navigate = useNavigate();
  const [stops, setStops] = useState<TourStop[] | null>(null);

  useEffect(() => {
    if (!isHomePath(location.pathname)) {
      navigate(HOME);
      return;
    }
    let tries = 0;
    let timer = 0;
    const look = () => {
      const found = availableStops(TOUR_STOPS, findTarget);
      if (found.length || tries++ >= 10) setStops(found);
      else timer = window.setTimeout(look, 150);
    };
    look();
    return () => window.clearTimeout(timer);
  }, [location.pathname, navigate]);

  if (!stops) return null;
  // Nothing found (an odd layout): the cards still explain each part, centered.
  return (
    <CoachMarks
      stops={stops.length ? stops : TOUR_STOPS}
      onFinish={endTour}
      onExit={endTour}
    />
  );
};

import { useId, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Compass } from "lucide-react";

import { useOnboarding } from "./onboardingState";
import "./onboarding.css";

/**
 * A small card on the dashboard after setup: "Take a quick tour" or "Not now".
 * Not modal: the dashboard stays usable and focus isn't moved; it's announced
 * politely. Esc inside it means "Not now".
 */
export const TourOffer = () => {
  const { startTour, dismissTourOffer } = useOnboarding();
  const titleId = useId();

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    dismissTourOffer();
  };

  return createPortal(
    <section
      className="onb-offer onb-tile"
      aria-labelledby={titleId}
      aria-live="polite"
      onKeyDown={onKeyDown}
    >
      <Compass aria-hidden="true" size={20} strokeWidth={1.8} />
      <div className="onb-offer-text">
        <h2 id={titleId}>Your desk is ready.</h2>
        <p>Want a one-minute tour of where things are?</p>
      </div>
      <div className="onb-offer-actions">
        <button
          type="button"
          className="onb-btn text small"
          onClick={dismissTourOffer}
        >
          Not now
        </button>
        <button
          type="button"
          className="onb-btn primary small"
          onClick={startTour}
        >
          Take a quick tour
        </button>
      </div>
    </section>,
    document.body,
  );
};

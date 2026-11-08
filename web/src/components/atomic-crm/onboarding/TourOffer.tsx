import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  CircleAlert,
  CircleCheck,
  Compass,
  LoaderCircle,
  X as XIcon,
} from "lucide-react";

import { backgroundLine, offerCopy } from "./firstRun";
import { useOnboarding } from "./onboardingState";
import "./onboarding.css";

/** How long "Your website is read" stays up before the status line hides itself. */
export const DONE_HIDE_MS = 6000;

const STATUS_ICON = {
  running: <LoaderCircle aria-hidden="true" size={16} className="onb-spin" />,
  done: <CircleCheck aria-hidden="true" size={16} />,
  failed: <CircleAlert aria-hidden="true" size={16} />,
} as const;

/**
 * A small card on the dashboard after setup: the optional tour ("Take a
 * quick tour" / "Not now") and, while a slow website read finishes in the
 * background, one status line. Not modal: the dashboard stays usable and
 * focus isn't moved; changes are announced politely. Esc inside it closes it.
 */
export const TourOffer = ({ offer }: { offer: boolean }) => {
  const { data, startTour, dismissTourOffer, update } = useOnboarding();
  const titleId = useId();
  const background =
    data.background && !data.background.hidden ? data.background : null;
  const copy = offerCopy(data);

  const hideStatus = () =>
    data.background &&
    update({ background: { ...data.background, hidden: true } });

  // A finished read says so briefly, then gets out of the way (a failure stays until closed).
  const doneAndShown = !offer && background?.status === "done";
  const hideLatest = useRef(hideStatus);
  useEffect(() => {
    hideLatest.current = hideStatus;
  });
  useEffect(() => {
    if (!doneAndShown) return;
    const timer = window.setTimeout(() => hideLatest.current(), DONE_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [doneAndShown]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    if (offer) dismissTourOffer();
    else hideStatus();
  };

  return createPortal(
    <section
      className="onb-offer onb-tile"
      aria-labelledby={offer ? titleId : undefined}
      aria-label={offer ? undefined : "Website reading"}
      onKeyDown={onKeyDown}
    >
      {offer && (
        <>
          <Compass aria-hidden="true" size={20} strokeWidth={1.8} />
          <div className="onb-offer-text">
            <h2 id={titleId}>{copy.title}</h2>
            <p>{copy.body}</p>
          </div>
        </>
      )}
      {background && (
        <div
          className="onb-offer-status"
          data-tone={background.status}
          role="status"
        >
          {STATUS_ICON[background.status]}
          <span>{backgroundLine(background)}</span>
          {!offer && (
            <button
              type="button"
              className="onb-icon-btn small"
              aria-label="Close"
              onClick={hideStatus}
            >
              <XIcon aria-hidden="true" size={16} />
            </button>
          )}
        </div>
      )}
      {offer && (
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
      )}
    </section>,
    document.body,
  );
};

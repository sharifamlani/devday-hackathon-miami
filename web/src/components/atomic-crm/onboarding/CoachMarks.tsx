import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  placeCoachMark,
  tourSelector,
  type Box,
  type Placement,
  type TourStop,
} from "./tour";
import { useFocusTrap } from "./useFocusTrap";
import { prefersReducedMotion } from "@/lib/motion";

const PAD = 6; // breathing room around the highlighted element

/** The "Reduce motion" choice, falling back to the OS setting. */
const reducedMotion = () =>
  typeof window !== "undefined" && prefersReducedMotion();

/**
 * Coach marks over the real homepage: dims the page, rings the current
 * `data-tour` target and shows a small card next to it. A modal dialog:
 * focus stays in the card, Esc stops the tour.
 */
export const CoachMarks = ({
  stops,
  onFinish,
  onExit,
}: {
  stops: TourStop[];
  onFinish: () => void;
  onExit: () => void;
}) => {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const stop = stops[index];
  useFocusTrap(rootRef, true, onExit);

  // Nothing to point at (the page changed under us): finish quietly.
  useEffect(() => {
    if (!stop) onFinish();
  }, [stop, onFinish]);

  // Bring the target into view, then track its box on scroll and resize.
  useEffect(() => {
    if (!stop) return;
    const el = document.querySelector<HTMLElement>(tourSelector(stop.id));
    // Missing or hidden (display:none): a centered card, no spotlight.
    if (!el || !el.getClientRects().length) {
      setBox(null);
      return;
    }
    el.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: reducedMotion() ? "auto" : "smooth",
    });
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        setBox({
          top: r.top - PAD,
          left: r.left - PAD,
          width: r.width + PAD * 2,
          height: r.height + PAD * 2,
        });
      });
    };
    measure();
    // Smooth scrolling moves the target for a moment after we start.
    const settle = window.setTimeout(measure, 400);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [stop]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const size = { width: card.offsetWidth, height: card.offsetHeight };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    setPlacement(
      box
        ? placeCoachMark(box, size, viewport)
        : {
            top: Math.max(16, (viewport.height - size.height) / 2),
            left: Math.max(16, (viewport.width - size.width) / 2),
            side: "center",
          },
    );
  }, [box, index]);

  // Announce each stop by moving focus to its title.
  useEffect(() => {
    headingRef.current?.focus();
  }, [index]);

  if (!stop) return null;
  const last = index === stops.length - 1;

  return createPortal(
    <div
      ref={rootRef}
      className="onb-coach"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      {/* Blocks clicks on the page while the tour runs. */}
      <div className="onb-coach-scrim" aria-hidden="true" />
      {box && (
        <div
          className="onb-coach-spot"
          aria-hidden="true"
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
          }}
        />
      )}
      <div
        ref={cardRef}
        className="onb-coach-card onb-tile"
        style={{
          top: placement?.top ?? -9999,
          left: placement?.left ?? -9999,
          opacity: placement ? 1 : 0,
        }}
      >
        <p className="onb-progress-text">
          Quick tour · {index + 1} of {stops.length}
        </p>
        <h2 id={titleId} ref={headingRef} tabIndex={-1}>
          {stop.title}
        </h2>
        <p id={bodyId}>{stop.body}</p>
        <div className="onb-actions">
          {index > 0 && (
            <button
              type="button"
              className="onb-btn quiet small"
              onClick={() => setIndex(index - 1)}
            >
              Back
            </button>
          )}
          <span className="onb-spacer" />
          {!last && (
            <button
              type="button"
              className="onb-btn text small"
              onClick={onFinish}
            >
              Skip tour
            </button>
          )}
          <button
            type="button"
            className="onb-btn primary small"
            onClick={() => (last ? onFinish() : setIndex(index + 1))}
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

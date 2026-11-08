import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";

import { ContextStep, FilesStep, OrganizationStep } from "./OnboardingSteps";
import { STEP_COUNT, useOnboarding } from "./onboardingState";
import { useFocusTrap } from "./useFocusTrap";
import "./onboarding.css";

/**
 * First run (plan.md §21.2.2), full screen and keyboard accessible:
 * drag in your files → tell us about your organization → the context agent
 * runs on its own → the dashboard. Esc (or "Finish later") closes it and
 * keeps progress; the dashboard then offers an optional quick tour.
 */
export const OnboardingFlow = () => {
  const { step, data, finishLater, finish, next, back, update } =
    useOnboarding();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <StepsScreen step={step} onEscape={finishLater}>
      {(headingRef) => {
        const frame = { headingRef, onBack: back };
        switch (step) {
          case 0:
            return (
              <FilesStep
                {...frame}
                onContinue={(files) => {
                  update({ files });
                  next();
                }}
              />
            );
          case 1:
            return (
              <OrganizationStep
                {...frame}
                onContinue={(links) => {
                  update({ links, linksSavedTo: "local" });
                  next();
                }}
              />
            );
          default:
            return (
              <ContextStep
                {...frame}
                links={data.links}
                onDone={(context, savedLive) => {
                  update({
                    context,
                    linksSavedTo: savedLive ? "live" : "local",
                  });
                  finish();
                  if (location.pathname !== "/") navigate("/");
                }}
              />
            );
        }
      }}
    </StepsScreen>
  );
};

/* ---------- The full-screen frame ---------- */

const StepsScreen = ({
  step,
  onEscape,
  children,
}: {
  step: number;
  onEscape: () => void;
  children: (
    headingRef: React.RefObject<HTMLHeadingElement | null>,
  ) => ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const progressId = useId();
  useFocusTrap(ref, true, onEscape);

  // Lock page scroll behind the flow.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Each step announces itself: focus moves to its heading.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  return createPortal(
    <div
      ref={ref}
      className="onb-screen"
      role="dialog"
      aria-modal="true"
      aria-label="Set up Donor Desk"
      aria-describedby={progressId}
      tabIndex={-1}
    >
      <div className="onb-card onb-tile">
        <div className="onb-top">
          <span className="onb-wordmark">Donor Desk</span>
          <button
            type="button"
            className="onb-btn text small"
            onClick={onEscape}
          >
            Finish later
          </button>
        </div>
        <div>
          <p id={progressId} className="onb-progress-text">
            Step {step + 1} of {STEP_COUNT}
          </p>
          <div
            className="onb-progress"
            style={{ gridTemplateColumns: `repeat(${STEP_COUNT}, 1fr)` }}
            aria-hidden="true"
          >
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <span key={i} data-done={i < step} data-current={i === step} />
            ))}
          </div>
        </div>
        {children(headingRef)}
      </div>
    </div>,
    document.body,
  );
};

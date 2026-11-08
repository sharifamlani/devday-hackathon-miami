import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { ChevronLeft } from "lucide-react";

import { FilesStep, OrganizationStep } from "./OnboardingSteps";
import { useQueryClient } from "@tanstack/react-query";
import { readOrganizationInBackground } from "./backgroundRead";
import { useOnboarding } from "./onboardingState";
import { useFocusTrap } from "./useFocusTrap";
import "./onboarding.css";

const SETUP_SCREEN_COUNT = 2;

/**
 * First run (plan.md §21.2.2), full screen and keyboard accessible:
 * drag in your files → tell us about your organization → the context agent
 * runs in the background while the dashboard opens. Esc (or "Finish later") closes it and
 * keeps progress, except while an import or a read is in flight.
 */
export const OnboardingFlow = () => {
  const { step, finishLater, finish, next, back, update } = useOnboarding();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const onBusy = useCallback((value: boolean) => setBusy(value), []);

  const goHome = () => {
    if (location.pathname !== "/") navigate("/");
  };

  // Older saved sessions may still point at the retired context receipt.
  useEffect(() => {
    if (step < 2) return;
    finish();
    if (location.pathname !== "/") navigate("/");
  }, [step, finish, location.pathname, navigate]);
  if (step >= 2) return null;

  return (
    <StepsScreen step={step} busy={busy} onBack={back} onEscape={finishLater}>
      {(headingRef) => {
        const frame = { headingRef, onBusy };
        switch (step) {
          case 0:
            return (
              <FilesStep
                {...frame}
                onContinue={(files) => {
                  update({ files });
                  next();
                }}
                onReviewDuplicates={() => {
                  // Setup waits; "Finish setup" in the profile menu resumes it.
                  finishLater();
                  navigate("/contacts");
                }}
              />
            );
          case 1:
            return (
              <OrganizationStep
                {...frame}
                onContinue={(links) => {
                  update({
                    links,
                    linksSavedTo: "local",
                    tourOffer: "dismissed",
                  });
                  void readOrganizationInBackground(links).finally(() =>
                    queryClient.invalidateQueries(),
                  );
                  finish();
                  goHome();
                }}
              />
            );
          default:
            return null;
        }
      }}
    </StepsScreen>
  );
};

/* ---------- The full-screen frame ---------- */

const StepsScreen = ({
  step,
  busy,
  onBack,
  onEscape,
  children,
}: {
  step: number;
  busy: boolean;
  onBack: () => void;
  onEscape: () => void;
  children: (
    headingRef: React.RefObject<HTMLHeadingElement | null>,
  ) => ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const progressId = useId();
  // A new step slides in from the side you're heading (forward from the right, back from the left).
  const previousStep = useRef(step);
  const direction = step >= previousStep.current ? "forward" : "back";
  useEffect(() => {
    previousStep.current = step;
  }, [step]);
  // Esc means "Finish later", but not while files upload or the site is read.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useFocusTrap(ref, true, () => {
    if (!busyRef.current) onEscape();
  });

  // Lock page scroll behind the flow.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Each step announces itself: focus moves to its first field when it asks
  // for one (data-autofocus), else to its heading.
  useEffect(() => {
    const field = ref.current?.querySelector<HTMLElement>("[data-autofocus]");
    (field ?? headingRef.current)?.focus();
  }, [step]);

  return createPortal(
    <div
      ref={ref}
      className="onb-screen"
      role="dialog"
      aria-modal="true"
      aria-label="Set up Gatherly"
      aria-describedby={progressId}
      aria-busy={busy || undefined}
      tabIndex={-1}
    >
      <div className="onb-card onb-tile">
        <div className="onb-head">
          <div className="onb-top">
            {step > 0 ? (
              <button
                type="button"
                className="onb-back"
                onClick={onBack}
                disabled={busy}
                aria-label={`Back to step ${step}`}
              >
                <ChevronLeft aria-hidden="true" size={18} />
              </button>
            ) : null}
            <span className="onb-wordmark">gatherly</span>
            <span className="onb-spacer" />
            <button
              type="button"
              className="onb-btn text small"
              onClick={onEscape}
              disabled={busy}
            >
              Finish later
            </button>
          </div>
          <div>
            <p id={progressId} className="onb-progress-text">
              Step {step + 1} of {SETUP_SCREEN_COUNT}
            </p>
            <div
              className="onb-progress"
              style={{
                gridTemplateColumns: `repeat(${SETUP_SCREEN_COUNT}, 1fr)`,
              }}
              aria-hidden="true"
            >
              {Array.from({ length: SETUP_SCREEN_COUNT }, (_, i) => (
                <span key={i} data-done={i < step} data-current={i === step} />
              ))}
            </div>
          </div>
        </div>
        <div key={step} className="onb-step-motion" data-direction={direction}>
          {children(headingRef)}
        </div>
      </div>
    </div>,
    document.body,
  );
};

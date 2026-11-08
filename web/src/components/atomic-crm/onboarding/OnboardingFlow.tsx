import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";

import { useIsMobile } from "@/hooks/use-mobile";
import { DATA_MODE } from "../providers/local/config";
import { useRunContext } from "../providers/local/hooks";
import type { ContextRunInput } from "../providers/local/types";
import { CoachMarks } from "./CoachMarks";
import {
  DonorsStep,
  GoalStep,
  OnlineStep,
  TourStep,
  WelcomeStep,
} from "./OnboardingSteps";
import { STEP_COUNT, useOnboarding, type OnlineLinks } from "./onboardingState";
import {
  TOUR_STOPS,
  availableStops,
  tourSelector,
  type TourStop,
} from "./tour";
import { useFocusTrap } from "./useFocusTrap";
import "./onboarding.css";

const findTarget = (id: TourStop["id"]) =>
  document.querySelector(tourSelector(id));

/**
 * Full-screen, keyboard-accessible setup: Welcome → online links → donors →
 * quarter goal → homepage tour. Esc (or "Finish later") closes it and keeps
 * progress; "Restart tour" in the user menu reopens it.
 */
export const OnboardingFlow = () => {
  const onboarding = useOnboarding();
  const { step, finishLater, finish, next, back, update } = onboarding;
  const [mode, setMode] = useState<"steps" | "tour">("steps");
  const [stops, setStops] = useState<TourStop[]>([]);
  const [nestedDialog, setNestedDialog] = useState(false);
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const runContext = useRunContext();

  // The tour points at the homepage: go there, then look for its targets.
  const onTourStep = mode === "steps" && step === STEP_COUNT - 1;
  useEffect(() => {
    if (!onTourStep) return;
    if (location.pathname !== "/") navigate("/");
    let tries = 0;
    let timer = 0;
    const look = () => {
      const found = availableStops(TOUR_STOPS, findTarget);
      setStops(found);
      if (!found.length && tries++ < 10) timer = window.setTimeout(look, 150);
    };
    look();
    return () => window.clearTimeout(timer);
  }, [onTourStep, location.pathname, navigate]);

  /** Live mode saves what POST /context/run accepts; the rest stays in this browser. */
  const saveLinks = (links: OnlineLinks) => {
    update({ links, linksSavedTo: "local" });
    if (DATA_MODE !== "local" || !links.website) return;
    const input: ContextRunInput = {
      website: links.website,
      x_url: links.x || null,
      linkedin_url: links.linkedin || null,
      instagram_url: links.instagram || null,
    };
    runContext.mutate(input, {
      onSuccess: () => update({ linksSavedTo: "live" }),
    });
  };

  if (mode === "tour") {
    return (
      <CoachMarks
        stops={stops}
        onBackToSetup={() => setMode("steps")}
        onFinish={finish}
        onExit={finishLater}
      />
    );
  }

  const canTour = !isMobile && stops.length > 0;

  return (
    <StepsScreen
      step={step}
      trapActive={!nestedDialog}
      onEscape={finishLater}
      status={<ContextRunStatus run={runContext} />}
    >
      {(headingRef) => {
        const frame = { headingRef, onBack: back, onSkip: next };
        switch (step) {
          case 0:
            return (
              <WelcomeStep
                {...frame}
                onContinue={(patch) => {
                  update(patch);
                  next();
                }}
              />
            );
          case 1:
            return (
              <OnlineStep
                {...frame}
                onContinue={(links) => {
                  saveLinks(links);
                  next();
                }}
              />
            );
          case 2:
            return (
              <DonorsStep
                {...frame}
                onNestedDialog={setNestedDialog}
                onContinue={(patch) => {
                  update(patch);
                  next();
                }}
              />
            );
          case 3:
            return (
              <GoalStep
                {...frame}
                onContinue={(goal) => {
                  update({ goal });
                  next();
                }}
              />
            );
          default:
            return (
              <TourStep
                {...frame}
                canTour={canTour}
                stops={isMobile || !stops.length ? TOUR_STOPS : stops}
                onStartTour={() => setMode("tour")}
                onFinish={finish}
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
  trapActive,
  onEscape,
  status,
  children,
}: {
  step: number;
  trapActive: boolean;
  onEscape: () => void;
  status: ReactNode;
  children: (
    headingRef: React.RefObject<HTMLHeadingElement | null>,
  ) => ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const progressId = useId();
  useFocusTrap(ref, trapActive, onEscape);

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
        {status}
        {children(headingRef)}
      </div>
    </div>,
    document.body,
  );
};

/** Website research runs in the background (up to 30 s live) while the person moves on. */
const ContextRunStatus = ({
  run,
}: {
  run: ReturnType<typeof useRunContext>;
}) => {
  let text: string | null = null;
  let tone: "info" | "good" | "error" = "info";
  if (run.isPending)
    text = "Reading your website in the background. You can keep going.";
  else if (run.isSuccess) {
    const count = run.data.facts.length;
    tone = "good";
    text = count
      ? `Found ${count} ${count === 1 ? "story" : "stories and facts"} on your website to use in outreach.`
      : "Your links are saved. No stories found on your website yet.";
  } else if (run.isError) {
    tone = "error";
    text = `Your links are saved in this browser. ${run.error.message}`;
  }
  return (
    <div aria-live="polite">
      {text && (
        <p className="onb-status" data-tone={tone}>
          {text}
        </p>
      )}
    </div>
  );
};

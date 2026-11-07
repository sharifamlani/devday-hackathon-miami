import { useEffect, useState } from "react";

import { useChatHost } from "../shell/chatHostContext";
import { OnlineStep } from "./OnlineStep";
import { UploadStep } from "./UploadStep";

const STEPS = ["Upload your data", "Where you are online"] as const;

/** Onboarding: step 1 upload, step 2 where you are online (plan.md §15, §17). */
export const OnboardingPage = () => {
  const [step, setStep] = useState<1 | 2>(1);
  const { setContext } = useChatHost();
  useEffect(() => setContext({ screen: "home" }), [setContext]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      <ol className="flex gap-2 text-sm" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStep((i + 1) as 1 | 2)}
              aria-current={step === i + 1 ? "step" : undefined}
              className={`rounded-full px-3 py-1 ${step === i + 1 ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>
      {step === 1 ? <UploadStep onNext={() => setStep(2)} /> : <OnlineStep />}
    </div>
  );
};

import { Compass, ListChecks, RotateCcw } from "lucide-react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useOnboarding } from "./onboardingState";

/**
 * For the user menu (UserMenu children). "Finish setup" reopens first-run
 * setup where it was left, until it's done; after that "Set up again"
 * reopens it at step 1 with the saved links and the last import's counts.
 * "Restart tour" runs the homepage tour again.
 */
export const RestartOnboardingMenuItem = () => {
  const { completed, step, start, startTour } = useOnboarding();
  return (
    <>
      {completed ? (
        <DropdownMenuItem onClick={() => start(0)} className="cursor-pointer">
          <RotateCcw aria-hidden="true" />
          Set up again
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem
          onClick={() => start(step)}
          className="cursor-pointer"
        >
          <ListChecks aria-hidden="true" />
          Finish setup
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={startTour} className="cursor-pointer">
        <Compass aria-hidden="true" />
        Restart tour
      </DropdownMenuItem>
    </>
  );
};

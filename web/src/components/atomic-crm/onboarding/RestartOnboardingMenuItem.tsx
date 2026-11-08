import { Compass, ListChecks } from "lucide-react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useOnboarding } from "./onboardingState";

/**
 * For the user menu (UserMenu children): "Restart tour" runs the homepage
 * tour again; "Finish setup" reopens first-run setup where it was left, and
 * shows only until setup is done.
 */
export const RestartOnboardingMenuItem = () => {
  const { completed, step, start, startTour } = useOnboarding();
  return (
    <>
      {!completed && (
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

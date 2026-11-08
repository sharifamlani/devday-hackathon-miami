import { Compass } from "lucide-react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useOnboarding } from "./onboardingState";

/**
 * For the user menu (UserMenu children): reopens onboarding at Welcome with
 * everything entered before prefilled, ending with the homepage tour.
 */
export const RestartOnboardingMenuItem = () => {
  const { start } = useOnboarding();
  return (
    <DropdownMenuItem onClick={() => start(0)} className="cursor-pointer">
      <Compass aria-hidden="true" />
      Restart tour
    </DropdownMenuItem>
  );
};

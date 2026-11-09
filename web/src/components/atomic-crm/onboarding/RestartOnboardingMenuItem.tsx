import { useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { Compass, ListChecks, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { openLanding } from "../landing/KindredLanding";
import { useOnboarding } from "./onboardingState";
import { useServiceHasPeople } from "./useServiceHasPeople";

/*
 * The question lives outside the menu: the menu closes (and unmounts its items) on click, so the dialog
 * reads its open state from this tiny store, mounted once beside the menu (RestartOnboardingDialog).
 */
let promptOpen = false;
const listeners = new Set<() => void>();
const setPrompt = (open: boolean) => {
  promptOpen = open;
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * For the user menu (UserMenu children), first in the list (docs/plans/user-journey.md §11). After setup,
 * "Restart onboarding" starts the journey again: straight to the landing on an empty app; with people
 * already in, it asks first, because importing the same files again would add everyone twice. Before setup
 * is done, "Finish setup" resumes it (#/onboarding after an import, else the landing). "Restart tour" runs
 * the homepage tour again.
 */
export const RestartOnboardingMenuItem = () => {
  const { completed, data, startTour } = useOnboarding();
  const hasPeople = useServiceHasPeople();
  const navigate = useNavigate();
  return (
    <>
      {completed ? (
        <DropdownMenuItem
          onClick={() => (hasPeople === false ? openLanding() : setPrompt(true))}
          className="cursor-pointer"
        >
          <RotateCcw aria-hidden="true" />
          Restart onboarding
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem
          onClick={() => (data.files ? navigate("/onboarding") : openLanding())}
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

/** Mount once beside the user menu. Skip upload keeps the data and goes to the organization step. */
export const RestartOnboardingDialog = () => {
  const open = useSyncExternalStore(subscribe, () => promptOpen, () => false);
  const navigate = useNavigate();
  return (
    <Dialog open={open} onOpenChange={setPrompt}>
      <DialogContent>
        <DialogTitle>Start setup again?</DialogTitle>
        <DialogDescription>
          Your people stay. Importing the same files again would add them twice: choose Skip upload to keep
          your data and go straight to your organization.
        </DialogDescription>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setPrompt(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setPrompt(false);
              openLanding();
            }}
          >
            Start over
          </Button>
          <Button
            onClick={() => {
              setPrompt(false);
              navigate("/onboarding");
            }}
          >
            Skip upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

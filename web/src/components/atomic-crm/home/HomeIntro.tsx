import { useState } from "react";

import { cn } from "@/lib/utils";
import type { Briefing } from "./briefing";
import { DailyBriefing } from "./DailyBriefing";
import { TryTheAgent } from "./demo/TryTheAgent";
import { focusRing } from "./tile";

type IntroView = "day" | "try";

const OPTIONS: { view: IntroView; label: string }[] = [
  { view: "day", label: "Your day" },
  { view: "try", label: "Try the agent" },
];

/** The small two-way switch at the right of the intro's headline. */
export const IntroToggle = ({ view, onChange }: { view: IntroView; onChange: (view: IntroView) => void }) => (
  <div role="group" aria-label="Show" className="inline-flex shrink-0 rounded-full bg-surface p-0.5 text-[11px] font-semibold">
    {OPTIONS.map((o) => (
      <button
        key={o.view}
        type="button"
        aria-pressed={view === o.view}
        data-testid={`intro-${o.view}`}
        onClick={() => onChange(o.view)}
        className={cn(
          "min-h-7 rounded-full px-2.5 transition-colors",
          view === o.view ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          focusRing,
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
);

/**
 * The Home chat's opening message: "Here's your day" by default, and one tap on the switch shows
 * "Try the agent" in its place (Sharif). Before there is a briefing, Try the agent shows on its own.
 */
export const HomeIntro = ({
  briefing,
  onStartTask,
}: {
  briefing: Briefing | null;
  onStartTask: (taskKey: string) => void;
}) => {
  const [view, setView] = useState<IntroView>("day");
  if (!briefing) return <TryTheAgent />;
  const toggle = <IntroToggle view={view} onChange={setView} />;
  return view === "day" ? (
    <DailyBriefing briefing={briefing} onStartTask={onStartTask} aside={toggle} />
  ) : (
    <TryTheAgent aside={toggle} />
  );
};

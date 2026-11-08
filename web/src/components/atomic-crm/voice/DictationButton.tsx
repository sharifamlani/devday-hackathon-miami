import { Mic, MicOff } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DictationState } from "./useDictationInput";

/**
 * The 🎙 in a chat box: idle, listening (pulsing; press again to stop) or
 * error (the reason in the tooltip and announced). Disabled where there is no
 * voice service (the snapshot build), with the reason in its tooltip.
 */
export const DictationButton = ({
  state,
  error,
  available,
  onToggle,
  className,
}: {
  state: DictationState;
  error: string | null;
  available: boolean;
  onToggle: () => void;
  className?: string;
}) => {
  const listening = state === "listening";
  const label = !available
    ? "Dictation needs the live service"
    : listening
      ? "Stop dictation"
      : "Dictate";
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        disabled={!available}
        aria-pressed={listening}
        aria-label={label}
        title={error ?? (listening ? "Listening… press to stop, Esc to cancel" : label)}
        data-dictation={state}
        className={cn(
          "relative grid size-9 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40",
          listening
            ? "bg-[#e5484d] text-white"
            : state === "error"
              ? "text-[#c62a2f] hover:bg-[#fdecec]"
              : "text-[#242728] hover:bg-[#edf0f2] dark:text-foreground dark:hover:bg-accent",
          className,
        )}
      >
        {listening && (
          <span
            aria-hidden
            className="absolute inset-0 animate-ping rounded-full bg-[#e5484d]/40 motion-reduce:animate-none"
          />
        )}
        {state === "error" ? (
          <MicOff className="relative size-5" aria-hidden />
        ) : (
          <Mic className="relative size-5" aria-hidden />
        )}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {listening ? "Listening" : (error ?? "")}
      </span>
    </>
  );
};

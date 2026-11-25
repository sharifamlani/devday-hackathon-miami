import { useEffect, useState } from "react";
import { Check, Loader2, PhoneOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STAFF_NAME } from "../../providers/local/config";
import type { CallScript } from "./scenarios";

/** Ringing before the "donor" picks up, and the gap between transcript lines. */
export const RING_MS = 1500;
export const LINE_MS = 1300;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

type Phase = "ringing" | "connected" | "ended";

/**
 * The public build's sample call, inside the call sheet: ringing, a scripted transcript line by line, then the
 * after-call summary and next steps. No phone is dialed; the card says so the whole time.
 */
export const DemoCall = ({
  name,
  script,
  onLogged,
  ringMs = RING_MS,
  lineMs = LINE_MS,
}: {
  name: string;
  script: CallScript;
  /** Called once when the call ends: the run adds its "logged to profile" step. */
  onLogged: () => void;
  ringMs?: number;
  lineMs?: number;
}) => {
  const [phase, setPhase] = useState<Phase>("ringing");
  const [lines, setLines] = useState(0);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (phase !== "ringing") return;
    const t = setTimeout(() => setPhase("connected"), ringMs);
    return () => clearTimeout(t);
  }, [phase, ringMs]);

  useEffect(() => {
    if (phase !== "connected") return;
    if (lines >= script.lines.length) {
      const t = setTimeout(() => setPhase("ended"), lineMs);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setLines((n) => n + 1), lines === 0 ? 300 : lineMs);
    return () => clearTimeout(t);
  }, [phase, lines, lineMs, script.lines.length]);

  useEffect(() => {
    if (phase !== "connected") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase === "ended") onLogged();
    // onLogged is the run's own callback; it adds the step once however often it is called.
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const first = name.split(/\s+/)[0];
  return (
    <div data-testid="demo-call" data-phase={phase} className="mt-2 rounded-lg border border-border bg-background p-2.5">
      <p className="text-[11px] text-muted-foreground">Sample call: no phone was dialed</p>
      {phase === "ringing" && (
        <p className="mt-1 flex items-center gap-2">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Calling {first}…
        </p>
      )}
      {phase === "connected" && (
        <p className="mt-1 flex items-center gap-2 font-medium">
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
          Connected · <span className="tabular-nums">{clock(seconds)}</span>
        </p>
      )}
      {phase !== "ringing" && (
        <ul aria-label="Transcript" className="mt-1.5 max-h-48 space-y-1 overflow-y-auto">
          {script.lines.slice(0, phase === "ended" ? script.lines.length : lines).map((l, i) => (
            <li key={i} className={cn("motion-enter", l.who === "donor" && "pl-3")}>
              <span className="font-semibold">{l.who === "you" ? STAFF_NAME : first}:</span> {l.text}
            </li>
          ))}
        </ul>
      )}
      {phase !== "ended" ? (
        <div className="mt-2">
          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setPhase("ended")}>
            <PhoneOff aria-hidden />
            Hang up
          </Button>
        </div>
      ) : (
        <div data-testid="after-call" className="mt-2 border-t border-border pt-2">
          <p className="flex items-center gap-1.5 font-semibold">
            <Check className="size-4" aria-hidden />
            Call ended{seconds > 0 ? ` · ${clock(seconds)}` : ""}
          </p>
          <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Summary</p>
          <p>{script.summary}</p>
          <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Next steps</p>
          <ul className="list-disc pl-4">
            {script.next_steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

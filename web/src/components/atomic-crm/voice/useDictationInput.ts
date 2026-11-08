import { useCallback, useEffect, useRef } from "react";

import { DATA_MODE } from "../providers/local/config";
import { useDictation } from "../providers/local/dictation";

/**
 * Dictation into a chat box (plan §20.8): press the mic, speak, and the words
 * fill the box live through WS /transcribe/live?purpose=dictation (Gemini
 * SMART mode, nothing stored). Press again to stop; Escape cancels and puts
 * back what the box held before.
 *
 * Finished phrases (finals) are appended to whatever the box holds at that
 * moment, so text typed while dictating is kept; words still being recognized
 * come back as `interim` for the box to show greyed.
 */
export type DictationState = "idle" | "listening" | "error";

/** Join two pieces of text with one space between them. */
export const joinText = (before: string, added: string) => {
  const a = before.replace(/\s+$/, "");
  const b = added.trim();
  if (!b) return before;
  return a ? `${a} ${b}` : b;
};

export const useDictationInput = (value: string, onChange: (value: string) => void) => {
  const d = useDictation();
  const { start, stop, reset } = d;
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // The box's text when dictation started (for Escape), and how much of the
  // joined finals has already been put in the box.
  const before = useRef<string | null>(null);
  const placed = useRef(0);

  const active = d.status === "connecting" || d.status === "listening" || d.status === "stopping";

  useEffect(() => {
    if (before.current == null) return;
    const added = d.final.slice(placed.current);
    placed.current = d.final.length;
    if (added.trim()) onChangeRef.current(joinText(valueRef.current, added));
  }, [d.final]);

  useEffect(() => {
    if (!active && d.status !== "error") before.current = null; // finished: nothing left to cancel
  }, [active, d.status]);

  const cancel = useCallback(() => {
    if (before.current != null) onChangeRef.current(before.current);
    before.current = null;
    placed.current = 0;
    reset();
  }, [reset]);

  /** Stop listening and drop anything still on its way (the box was just sent). */
  const halt = useCallback(() => {
    if (before.current == null) return;
    before.current = null;
    placed.current = 0;
    reset();
  }, [reset]);

  const toggle = useCallback(() => {
    if (active) {
      stop();
      return;
    }
    before.current = valueRef.current;
    placed.current = 0;
    void start();
  }, [active, start, stop]);

  // Escape cancels wherever focus is, without also closing the panel around the box.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, cancel]);

  const state: DictationState =
    d.status === "error" || (d.status === "unavailable" && d.error) ? "error" : active ? "listening" : "idle";

  return {
    state,
    /** Words still being recognized; show them greyed after the box's text. */
    interim: active ? d.interim : "",
    error: state === "error" ? d.error : null,
    /** Voice needs the local service; the snapshot (Vercel) build has none. */
    available: DATA_MODE === "local",
    toggle,
    cancel,
    halt,
  };
};

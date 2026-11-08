import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  serializeWorkspace,
  toggleWorkspace,
  type WorkspaceView,
} from "./workspaceView";

export const DICTATION_TOGGLE_EVENT = "desk:dictation-toggle";

export type Hotkey = { view: WorkspaceView } | { dictation: true };

type KeyLike = Pick<
  KeyboardEvent,
  "code" | "altKey" | "ctrlKey" | "shiftKey" | "metaKey"
>;

/** Physical keys (event.code), so Option characters on a Mac (ç, †, µ) don't matter. */
const ALT_VIEWS: Record<string, WorkspaceView> = {
  KeyC: "calendar",
  KeyT: "tasks",
  KeyM: "crm",
};

/** What a key press means, or null. Exact modifiers only: Ctrl+Alt+C, Shift+Alt+C do nothing. */
export function hotkeyFor(e: KeyLike): Hotkey | null {
  if (e.shiftKey || e.metaKey) return null;
  if (e.altKey && !e.ctrlKey) {
    if (e.code === "KeyV") return { dictation: true };
    const view = ALT_VIEWS[e.code];
    return view ? { view } : null;
  }
  if (e.ctrlKey && !e.altKey && e.code === "KeyI") return { view: "impact" };
  return null;
}

/** The tile a panel zooms out of, if it is on screen. */
export function tileFor(view: WorkspaceView): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(
    `[data-zoom-source="${view}"]`,
  );
  return el && el.offsetParent !== null ? el : null;
}

const modalOpen = () =>
  !!document.querySelector('[role="dialog"],[role="alertdialog"]');

/** Text fields keep their keys (Option+C types ç on a Mac); only the home composer opts in. */
const typingOutsideComposer = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[data-hotkeys="composer"]')) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
};

/**
 * Alt+C Calendar, Alt+T Tasks, Alt+M CRM, Ctrl+I Impact, Alt+V dictation.
 * One document listener; works while typing in the composer, never in other
 * text fields or over a modal.
 * Off Home the panel keys open Home with that panel.
 */
export function useWorkspaceHotkeys() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented || e.isComposing) return;
      const hit = hotkeyFor(e);
      if (!hit || modalOpen()) return;
      if (typingOutsideComposer(e.target)) return;
      if ("dictation" in hit) {
        if (pathname !== "/") return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(DICTATION_TOGGLE_EVENT));
        return;
      }
      e.preventDefault();
      if (pathname !== "/") {
        navigate(
          { pathname: "/", search: serializeWorkspace("", hit.view) },
          { state: { zoom: true } },
        );
        return;
      }
      toggleWorkspace(hit.view, tileFor(hit.view));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate, pathname]);
}

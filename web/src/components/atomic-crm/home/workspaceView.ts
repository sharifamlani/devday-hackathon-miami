import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MouseEvent,
} from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import {
  getLastSource,
  notifyCommitted,
  runZoomTransition,
  type ZoomKind,
} from "./zoomTransition";

export const WORKSPACE_VIEWS = ["calendar", "tasks", "crm", "impact"] as const;
export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number];

/** "donors" and "organizations" are the legacy names for the crm view (see crmSubview). */
export function parseWorkspace(
  search: string | URLSearchParams | null | undefined,
): WorkspaceView | null {
  const params =
    typeof search === "string" || search == null
      ? new URLSearchParams(search ?? "")
      : search;
  const raw = params.get("workspace");
  if (raw === "donors" || raw === "organizations") return "crm";
  return (WORKSPACE_VIEWS as readonly string[]).includes(raw ?? "")
    ? (raw as WorkspaceView)
    : null;
}

/** Which CRM list the URL asks for; Donors first (givers). */
export function crmSubview(
  search: string | URLSearchParams | null | undefined,
): "donors" | "organizations" {
  const params =
    typeof search === "string" || search == null
      ? new URLSearchParams(search ?? "")
      : search;
  return params.get("workspace") === "organizations"
    ? "organizations"
    : "donors";
}

/** Returns a "?a=b" search string (or "") with workspace set or removed. */
export function serializeWorkspace(
  search: string | URLSearchParams,
  view: WorkspaceView | null,
): string {
  const params = new URLSearchParams(
    typeof search === "string" ? search : search.toString(),
  );
  if (view) params.set("workspace", view);
  else params.delete("workspace");
  const out = params.toString();
  return out ? `?${out}` : "";
}

/** What the last caller asked for; set synchronously so rapid toggles stay consistent. */
let target: WorkspaceView | null | undefined;
/** What is actually rendered right now (set on every HomePage render). */
let actual: WorkspaceView | null = null;
let nav: {
  push: (view: WorkspaceView) => void;
  replace: (view: WorkspaceView) => void;
  closeReplace: () => void;
} | null = null;

export function resetWorkspaceStateForTest(
  fake?: typeof nav,
  current: WorkspaceView | null = null,
  _zoomed = false,
) {
  target = undefined;
  actual = current;
  nav = fake ?? null;
}

function syncToTarget(): void | Promise<void> {
  if (!nav || target === undefined || target === actual) return;
  const n = nav;
  const want = target;
  // Close replaces the entry instead of history.back(): back costs ~200ms of router work
  // inside the transition callback (measured), replace costs ~2ms. Browser Back still closes.
  if (want === null) {
    flushSync(() => n.closeReplace());
  } else if (actual === null) {
    flushSync(() => n.push(want));
  } else {
    flushSync(() => n.replace(want));
  }
}

/**
 * A request can land between the router accepting a navigation and HomePage committing it (the
 * commit is asynchronous). `target` is then ahead of what is on screen, and the early return in
 * syncToTarget leaves the old navigation to win (a quick open+close strands the panel open).
 * After every commit, replay a request that the committed state does not satisfy.
 */
function reconcileAfterCommit() {
  if (!nav || target === undefined || target === actual) return;
  const want = target;
  queueMicrotask(() => {
    if (!nav || target !== want || actual === want) return;
    const kind: ZoomKind =
      want === null ? "close" : actual === null ? "open" : "switch";
    runZoomTransition({ kind, update: syncToTarget, view: want });
  });
}

/** What useWorkspaceView does for each committed render (exported so tests can drive it). */
export function commitWorkspaceForTest(view: WorkspaceView | null) {
  actual = view;
  if (target === view) target = undefined;
  reconcileAfterCommit();
}

function request(
  next: WorkspaceView | null,
  sourceEl?: HTMLElement | null,
): boolean {
  const current = target === undefined ? actual : target;
  if (!nav || next === current) return false;
  const kind: ZoomKind =
    next === null ? "close" : current === null ? "open" : "switch";
  target = next;
  runZoomTransition({
    kind,
    update: syncToTarget,
    sourceEl,
    view: next ?? current,
  });
  return true;
}

export const openWorkspace = (
  view: WorkspaceView,
  sourceEl?: HTMLElement | null,
) => request(view, sourceEl);
export const closeWorkspace = () => request(null);
export const toggleWorkspace = (
  view: WorkspaceView,
  sourceEl?: HTMLElement | null,
) => {
  const current = target === undefined ? actual : target;
  return current === view ? request(null) : request(view, sourceEl);
};

/** Esc closes the panel unless a dialog/menu owns the key; reads the requested state. */
export function handleWorkspaceEscape(
  e: Pick<KeyboardEvent, "key" | "defaultPrevented">,
) {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if ((target === undefined ? actual : target) === null) return;
  if (document.querySelector('[role="dialog"],[role="listbox"],[role="menu"]'))
    return;
  closeWorkspace();
}

/** Mount once (HomePage). Wires the module-level actions to react-router. */
export function useWorkspaceView() {
  const location = useLocation();
  const navigate = useNavigate();
  const search = location.search;
  const view = useMemo(() => parseWorkspace(search), [search]);
  const zoomed = !!(location.state as { zoom?: boolean } | null)?.zoom;
  actual = view;
  if (target === view) target = undefined;

  useEffect(() => {
    nav = {
      push: (v) =>
        navigate(
          { search: serializeWorkspace(search, v) },
          { state: { zoom: true } },
        ),
      replace: (v) =>
        navigate(
          { search: serializeWorkspace(search, v) },
          { replace: true, state: { zoom: true } },
        ),
      closeReplace: () =>
        navigate(
          { search: serializeWorkspace(search, null) },
          { replace: true },
        ),
    };
    return () => {
      nav = null;
    };
  }, [navigate, search]);

  // Cold load straight into a view: make Back close it instead of leaving the app.
  useEffect(() => {
    if (view && !zoomed) {
      navigate({ search: serializeWorkspace(search, null) }, { replace: true });
      navigate(
        { search: serializeWorkspace(search, view) },
        { state: { zoom: true } },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tell a pending view transition the new state is in the DOM; restore focus on close.
  const prev = useRef(view);
  useLayoutEffect(() => {
    notifyCommitted();
    reconcileAfterCommit();
    if (prev.current && !view) {
      const src = getLastSource();
      if (src?.isConnected) {
        const target = src.matches("button,a,[tabindex]")
          ? src
          : (src.querySelector<HTMLElement>("button,a,[tabindex]") ?? src);
        target.focus?.({ preventScroll: true });
      }
    }
    prev.current = view;
  }, [view]);

  // Esc closes the panel unless a dialog/menu owns the key. One listener for the page's life
  // that reads the requested state, so Esc right after an open (before it commits) still closes.
  useEffect(() => {
    window.addEventListener("keydown", handleWorkspaceEscape);
    return () => window.removeEventListener("keydown", handleWorkspaceEscape);
  }, []);

  // Dev builds (or VITE_EXPOSE_DESK=1 builds): lets scripts/verify_home_zoom.py drive the panels.
  useEffect(() => {
    if (!import.meta.env.DEV && import.meta.env.VITE_EXPOSE_DESK !== "1")
      return;
    (window as unknown as { __desk?: unknown }).__desk = {
      openWorkspace,
      closeWorkspace,
      toggleWorkspace,
    };
  }, []);

  return { view, openWorkspace, closeWorkspace, toggleWorkspace };
}

/**
 * onClick for a plain link that should zoom a panel out of its tile instead of navigating.
 * Modified clicks (new tab) and a Home that is not mounted fall through to the link's own `to`.
 */
export const zoomClick =
  (view: WorkspaceView) => (e: MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const tile = e.currentTarget.closest<HTMLElement>(".home-tile");
    if (openWorkspace(view, tile)) e.preventDefault();
  };

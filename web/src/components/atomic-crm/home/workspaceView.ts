import { useCallback, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { runZoomTransition, type ZoomKind, waitForCommit } from "./zoomTransition";

export const WORKSPACE_VIEWS = [
  "calendar",
  "tasks",
  "crm",
  "impact",
  "organizations",
] as const;
export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number];

/** "donors" is the legacy name for the crm view. */
export function parseWorkspace(
  search: string | URLSearchParams | null | undefined,
): WorkspaceView | null {
  const params =
    typeof search === "string" || search == null
      ? new URLSearchParams(search ?? "")
      : search;
  const raw = params.get("workspace");
  if (raw === "donors") return "crm";
  return (WORKSPACE_VIEWS as readonly string[]).includes(raw ?? "")
    ? (raw as WorkspaceView)
    : null;
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
let actualZoomState = false;
let nav: {
  push: (view: WorkspaceView) => void;
  replace: (view: WorkspaceView) => void;
  closeReplace: () => void;
  back: () => void;
} | null = null;

export function resetWorkspaceStateForTest(
  fake?: typeof nav,
  current: WorkspaceView | null = null,
  zoomed = false,
) {
  target = undefined;
  actual = current;
  actualZoomState = zoomed;
  nav = fake ?? null;
}

function syncToTarget(): void | Promise<void> {
  if (!nav || target === undefined || target === actual) return;
  const n = nav;
  const want = target;
  if (want === null) {
    if (actualZoomState) {
      const done = waitForCommit();
      n.back();
      return done;
    }
    flushSync(() => n.closeReplace());
  } else if (actual === null) {
    flushSync(() => n.push(want));
  } else {
    flushSync(() => n.replace(want));
  }
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
  runZoomTransition({ kind, update: syncToTarget, sourceEl });
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

/** Mount once (HomePage). Wires the module-level actions to react-router. */
export function useWorkspaceView() {
  const location = useLocation();
  const navigate = useNavigate();
  const search = location.search;
  const view = useMemo(() => parseWorkspace(search), [search]);
  const zoomed = !!(location.state as { zoom?: boolean } | null)?.zoom;
  actual = view;
  actualZoomState = zoomed;
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
      back: () => navigate(-1),
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

  const open = useCallback(openWorkspace, []);
  return { view, openWorkspace: open, closeWorkspace, toggleWorkspace };
}

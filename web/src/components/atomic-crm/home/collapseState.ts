import { useCallback, useSyncExternalStore } from "react";

/** Which overview tiles are folded to their title row, remembered in this browser. */
export const TILE_COLLAPSE_KEY = "donordesk.home.collapsed";
export type TileKey = "q4" | "calendar" | "tasks" | "crm" | "files";

const listeners = new Set<() => void>();
let cache: Record<string, boolean> | null = null;

const read = (): Record<string, boolean> => {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(TILE_COLLAPSE_KEY) ?? "{}",
    );
    cache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    cache = {};
  }
  return cache!;
};

export const setTileCollapsed = (key: TileKey, collapsed: boolean) => {
  const next = { ...read(), [key]: collapsed };
  if (!collapsed) delete next[key];
  cache = next;
  try {
    window.localStorage.setItem(TILE_COLLAPSE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or blocked storage: the choice holds for this page only.
  }
  listeners.forEach((listener) => listener());
};

/** Forget the in-memory copy (tests). */
export const resetTileCollapseForTest = () => {
  cache = null;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** [collapsed, toggle] for one overview tile. */
export const useTileCollapsed = (key: TileKey): [boolean, () => void] => {
  const collapsed = useSyncExternalStore(
    subscribe,
    () => Boolean(read()[key]),
    () => false,
  );
  const toggle = useCallback(() => setTileCollapsed(key, !read()[key]), [key]);
  return [collapsed, toggle];
};

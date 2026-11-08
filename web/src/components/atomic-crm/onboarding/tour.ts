/**
 * The homepage tour: which parts of the real UI it points at, and where the
 * coach mark goes. Targets are elements with `data-tour="<id>"`; a stop whose
 * target isn't on the page (or isn't visible) is skipped.
 */

export const TOUR_IDS = [
  "ask",
  "voice",
  "glance",
  "tasks",
  "crm",
  "chat",
  "projects",
] as const;
export type TourId = (typeof TOUR_IDS)[number];

export interface TourStop {
  id: TourId;
  title: string;
  body: string;
}

export const TOUR_STOPS: TourStop[] = [
  {
    id: "ask",
    title: "Ask Donor Desk",
    body: "Ask about your donors in plain words, like “Who gave this quarter and hasn’t been thanked?”",
  },
  {
    id: "voice",
    title: "Live transcript",
    body: "Tap the yellow button during a call or meeting. Donor Desk writes the notes and a summary for you.",
  },
  {
    id: "glance",
    title: "Today at a glance",
    body: "Gifts at risk, possible duplicates and today’s tasks, counted for you each morning.",
  },
  {
    id: "tasks",
    title: "Tasks to do today",
    body: "Open a task to see why it matters and what to do next, like a call or a thank-you note.",
  },
  {
    id: "crm",
    title: "CRM",
    body: "Find a donor, see their giving history and fill in missing details.",
  },
  {
    id: "chat",
    title: "Your agent",
    body: "Ask for drafts, plans and reminders. Nothing is sent without your approval.",
  },
  {
    id: "projects",
    title: "Projects",
    body: "Group donors, notes and drafts by campaign or event in the Projects sidebar.",
  },
];

export const tourSelector = (id: TourId) => `[data-tour="${id}"]`;

/** Stops whose target is in the DOM and has a box (display:none targets are skipped). */
export const availableStops = (
  stops: TourStop[],
  find: (id: TourId) => { getClientRects(): { length: number } } | null,
): TourStop[] =>
  stops.filter((stop) => {
    const el = find(stop.id);
    return !!el && el.getClientRects().length > 0;
  });

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Placement {
  top: number;
  left: number;
  side: "below" | "above" | "center";
}

/**
 * Puts a card of `card` size next to `target`: below it when it fits, else
 * above, else centered on screen. Always kept `margin` px inside the viewport.
 */
export const placeCoachMark = (
  target: Box,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 12,
  margin = 16,
): Placement => {
  const maxLeft = Math.max(margin, viewport.width - card.width - margin);
  const left = Math.min(
    maxLeft,
    Math.max(margin, target.left + target.width / 2 - card.width / 2),
  );
  const below = target.top + target.height + gap;
  if (below + card.height <= viewport.height - margin) {
    return { top: below, left, side: "below" };
  }
  const above = target.top - gap - card.height;
  if (above >= margin) return { top: above, left, side: "above" };
  return {
    top: Math.max(margin, (viewport.height - card.height) / 2),
    left: Math.max(margin, (viewport.width - card.width) / 2),
    side: "center",
  };
};

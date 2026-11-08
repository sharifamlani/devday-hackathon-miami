/**
 * The homepage tour: which parts of the real UI it points at, and where the
 * coach mark goes. Targets are elements with `data-tour="<id>"`; a stop whose
 * target isn't on the page (or isn't visible) is skipped.
 */

export const TOUR_IDS = [
  "overview",
  "calendar",
  "tasks",
  "crm",
  "projects",
  "composer",
  "voice",
  "ask",
] as const;
export type TourId = (typeof TOUR_IDS)[number];

export interface TourStop {
  id: TourId;
  title: string;
  body: string;
}

/** In the homepage's order: the workspace rail top to bottom, the agent, then live transcript and Ask. */
export const TOUR_STOPS: TourStop[] = [
  {
    id: "overview",
    title: "Overview",
    body: "Q4 progress against your goal, and today at a glance: gifts at risk, possible duplicates and tasks.",
  },
  {
    id: "calendar",
    title: "Calendar",
    body: "This week's events and Give Miami Day. Pick a day to plan who to reach out to.",
  },
  {
    id: "tasks",
    title: "Tasks",
    body: "Today's calls, thank-yous and reviews. Open one to see why it matters and what to do next.",
  },
  {
    id: "crm",
    title: "Donors",
    body: "Find a donor, see who needs attention, and open the full Donors and Organizations lists.",
  },
  {
    id: "projects",
    title: "Projects",
    body: "Campaigns, saved Ask questions and donor lists like Needs attention, in one place.",
  },
  {
    id: "composer",
    title: "Your agent",
    body: "Ask for drafts, plans and reminders in plain words, or tap a suggestion. Nothing is sent without your approval.",
  },
  {
    id: "voice",
    title: "Live transcript",
    body: "Start a live transcript during a call or meeting. Gatherly writes the notes and a summary for you.",
  },
  {
    id: "ask",
    title: "Ask",
    body: "Ask about your donors, like “Who gave this quarter and hasn’t been thanked?”, in a side panel you can keep open.",
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

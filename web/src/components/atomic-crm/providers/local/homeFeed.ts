import { useArtifacts, useCalendarFeed } from "./calendarFeed";
import { useEndpointSource } from "./endpoint";
import { usePeopleAttention, useHomeSummary, useTargetQuarters, type AttentionBadge } from "./homeSummary";
import { useTasks } from "./tasks";

/**
 * Everything the home board (home/, #78) reads from plan.md §21.5 in one
 * hook, with where each answer comes from. Swapping the home's derived data
 * for these is a one-line change per card:
 *
 *   const home = useHomeData(today);
 *   home.summary.data?.gifts_at_risk      // "Today at a glance"
 *   home.attention.data                   // CRM tile rows (+ attentionTag)
 *   home.quarters.data?.quarters          // the gauge's quarter strip
 *   home.tasks.data                       // the task card + list
 *   home.calendar.data / home.artifacts.data
 *   home.sources.summary === "mock"       // label mock data on screen
 */
export const useHomeData = (today: string, calendarDays = 14) => {
  const to = new Date(`${today}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + calendarDays);
  const until = to.toISOString().slice(0, 10);
  return {
    summary: useHomeSummary(),
    attention: usePeopleAttention(6),
    quarters: useTargetQuarters(today),
    tasks: useTasks({ due: "today" }),
    calendar: useCalendarFeed(today, until),
    artifacts: useArtifacts(),
    sources: {
      summary: useEndpointSource("GET", "/home/summary"),
      attention: useEndpointSource("GET", "/people/attention"),
      quarters: useEndpointSource("GET", "/targets/quarters"),
      tasks: useEndpointSource("GET", "/tasks"),
      calendar: useEndpointSource("GET", "/calendar"),
      artifacts: useEndpointSource("GET", "/artifacts"),
    },
  };
};

/** The tones home/homeData.ts's DonorTag uses. */
export type AttentionTone = "alert" | "warn" | "good" | "quiet";

const BADGES: Record<string, { label: string; tone: AttentionTone }> = {
  failed: { label: "Card failed", tone: "alert" }, // what the service sends
  card_failed: { label: "Card failed", tone: "alert" },
  // A missed month that giving resumed after, and a usual gift that's late: amber, not red.
  skipped: { label: "Skipped", tone: "warn" },
  late: { label: "Late", tone: "warn" },
  new: { label: "New", tone: "good" },
  thanked: { label: "Thanked", tone: "good" },
  not_yet: { label: "Not yet", tone: "quiet" },
};

/** GET /people/attention's badge → the CRM tile's {label, tone}. */
export const attentionTag = (badge: AttentionBadge): { label: string; tone: AttentionTone } =>
  BADGES[badge] ?? { label: badge.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), tone: "quiet" };

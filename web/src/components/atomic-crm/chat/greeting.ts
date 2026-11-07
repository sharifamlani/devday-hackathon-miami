/**
 * The panel's opening line and quick actions. Day counts come from the API
 * (give_miami_day_days_away); the UI never invents one. Community chips never
 * ask for a donation (plan.md §17 copy rule 1).
 */
import type { ChatScreen } from "./threadStore";

export interface GreetingInput {
  screen: ChatScreen;
  giveMiamiDayDaysAway: number | null;
  upcomingEvents: number | null;
  selectionCount: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const greetingText = ({ giveMiamiDayDaysAway, upcomingEvents }: GreetingInput) => {
  const days =
    giveMiamiDayDaysAway == null
      ? null
      : giveMiamiDayDaysAway === 0
        ? "Give Miami Day is today."
        : giveMiamiDayDaysAway > 0
          ? `Give Miami Day is in ${plural(giveMiamiDayDaysAway, "day")}.`
          : null;
  const plan =
    upcomingEvents && upcomingEvents > 0
      ? `Plan outreach for ${plural(upcomingEvents, "upcoming event")}?`
      : "What should we work on?";
  return days ? `${days} ${plan}` : `Hi! ${plan}`;
};

export const quickActions = (input: GreetingInput): string[] => {
  const { screen, upcomingEvents, selectionCount } = input;
  const selected =
    selectionCount > 0 ? [`Draft a note to the ${plural(selectionCount, "selected person")}`] : [];
  const events =
    upcomingEvents && upcomingEvents > 0
      ? [`Plan outreach for ${plural(upcomingEvents, "upcoming event")}`]
      : [];
  switch (screen) {
    case "giver":
      return [
        ...selected,
        "Who should I call before Give Miami Day?",
        "Show givers who are lapsing",
        "Draft thank-you notes for recent gifts",
      ];
    case "neighbor":
      return [...selected, "Who joined this month?", "Invite neighbors to the next program"];
    case "community":
      return [
        ...selected,
        "Summarize community trends",
        "Who hasn't heard from us this quarter?",
      ];
    case "calendar":
      return [...events, "Who should get invites to the next event?"];
    default:
      return [...selected, ...events, "Who should I call before Give Miami Day?"];
  }
};

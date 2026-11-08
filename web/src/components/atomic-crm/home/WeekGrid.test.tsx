import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { CalendarItem } from "../providers/local/calendarFeed";
import {
  eventKind,
  hourLabel,
  hourWindow,
  placeDay,
  TimeGrid,
} from "./WeekGrid";

const ev = (
  title: string,
  date: string,
  time: string | null,
  event_kind: string | null = "community",
) =>
  ({
    date,
    time,
    title,
    kind: "event",
    source: "staff",
    ref: `${date}-${title}`,
    event_kind,
  }) as CalendarItem & { event_kind: string | null };

const WEEK = [
  "2026-11-15",
  "2026-11-16",
  "2026-11-17",
  "2026-11-18",
  "2026-11-19",
  "2026-11-20",
  "2026-11-21",
];

describe("week grid layout", () => {
  it("shows at least 9a–1p and widens to fit early or late events", () => {
    expect(hourWindow([])).toEqual({ start: 540, end: 780 });
    expect(
      hourWindow([ev("5K", WEEK[0], "08:00"), ev("Gala", WEEK[1], "18:30")]),
    ).toEqual({
      start: 480,
      end: 20 * 60,
    });
    expect(hourLabel(480)).toBe("8a");
    expect(hourLabel(720)).toBe("12p");
  });

  it("puts overlapping blocks in lanes and leaves separate ones full width", () => {
    const placed = placeDay([
      ev("Post-race", WEEK[0], "08:30"),
      ev("5K", WEEK[0], "08:00"),
      ev("Lunch", WEEK[0], "12:00"),
      ev("All day", WEEK[0], null),
    ]);
    expect(placed.map((p) => [p.event.title, p.lane, p.lanes])).toEqual([
      ["5K", 0, 2],
      ["Post-race", 1, 2],
      ["Lunch", 0, 1],
    ]);
  });

  it("colors by event type, like the full calendar", () => {
    expect(eventKind(ev("a", WEEK[0], null, "fundraising"))).toBe(
      "fundraising",
    );
    expect(eventKind(ev("b", WEEK[0], null, null))).toBe("other");
  });
});

describe("TimeGrid", () => {
  it("the week shows seven columns, an all-day row and a colored block per event", async () => {
    const onOpen = vi.fn();
    const screen = await render(
      <TimeGrid
        days={WEEK}
        today="2026-11-08"
        events={[
          ev("The Give Miami 5K", WEEK[0], "08:00"),
          ev("Give Miami Day", WEEK[4], null, "fundraising"),
        ]}
        onOpenEvent={onOpen}
      />,
    );
    expect(document.querySelectorAll(".home-cal-column")).toHaveLength(7);
    await expect.element(screen.getByText("all-day")).toBeVisible();
    const block = screen.getByRole("button", {
      name: "The Give Miami 5K, Sunday, Nov 15, 8:00 AM",
    });
    await expect.element(block).toHaveAttribute("data-kind", "community");
    await block.click();
    expect(onOpen).toHaveBeenCalledWith("2026-11-15");
    await expect
      .element(
        screen.getByRole("button", { name: /^Give Miami Day, Thursday/ }),
      )
      .toHaveAttribute("data-kind", "fundraising");
  });

  it("the day view shows one column with times on the blocks", async () => {
    const screen = await render(
      <TimeGrid
        days={[WEEK[0]]}
        today="2026-11-08"
        events={[ev("The Give Miami 5K", WEEK[0], "08:00")]}
        onOpenEvent={() => {}}
        detailed
      />,
    );
    expect(document.querySelectorAll(".home-cal-column")).toHaveLength(1);
    await expect.element(screen.getByText("8:00")).toBeVisible();
  });
});

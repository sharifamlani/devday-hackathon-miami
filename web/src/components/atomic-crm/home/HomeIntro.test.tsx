import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { render } from "vitest-browser-react";

import { AskSessionProvider } from "../ask/AskSession";
import type { Briefing } from "./briefing";
import { HomeIntro } from "./HomeIntro";

const briefing: Briefing = {
  headline: "Here’s your day.",
  lines: [{ key: "reached", text: "You’ve reached 3 people today.", action: null }],
};

const wrap = (node: ReactNode) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient()}>
      <AskSessionProvider>{node}</AskSessionProvider>
    </QueryClientProvider>
  </MemoryRouter>
);

describe("HomeIntro", () => {
  it("opens on Here's your day; the switch shows Try the agent in its place, and back", async () => {
    const screen = await render(wrap(<HomeIntro briefing={briefing} onStartTask={() => {}} />));
    await expect.element(screen.getByText("Here’s your day.")).toBeVisible();
    await expect.element(screen.getByTestId("intro-day")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("try-lookup").elements()).toHaveLength(0);

    await screen.getByTestId("intro-try").click();
    await expect.element(screen.getByTestId("try-lookup")).toBeVisible();
    await expect.element(screen.getByTestId("intro-try")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Here’s your day.").elements()).toHaveLength(0);

    await screen.getByTestId("intro-day").click();
    await expect.element(screen.getByText("You’ve reached 3 people today.")).toBeVisible();
    expect(screen.getByTestId("try-lookup").elements()).toHaveLength(0);
  });

  it("before there is a briefing, shows Try the agent alone, with no switch", async () => {
    const screen = await render(wrap(<HomeIntro briefing={null} onStartTask={() => {}} />));
    await expect.element(screen.getByTestId("try-call")).toBeVisible();
    expect(screen.getByTestId("intro-day").elements()).toHaveLength(0);
  });
});

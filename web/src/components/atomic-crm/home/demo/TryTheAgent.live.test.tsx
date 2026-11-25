import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { render } from "vitest-browser-react";

import { AskSessionProvider } from "../../ask/AskSession";
import { getDemoState, resetDemoRuns } from "./demoRun";
import { SCENARIOS } from "./scenarios";
import { TryTheAgent } from "./TryTheAgent";

// On the laptop the rows talk to the live agent: no sample run, no Sample run tag.
vi.mock("../../providers/local/config", async (orig) => ({
  ...(await orig<object>()),
  DATA_MODE: "local",
}));
const sendToAgent = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../agentChat", async (orig) => ({ ...(await orig<object>()), sendToAgent }));

describe("Try the agent (laptop, live agent)", () => {
  beforeEach(() => {
    resetDemoRuns();
    sendToAgent.mockClear();
  });

  it("each row sends its prompt to the live agent instead of playing a sample", async () => {
    const screen = await render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <AskSessionProvider>
            <TryTheAgent />
          </AskSessionProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Sample run", { exact: true }).elements()).toHaveLength(0);
    await screen.getByTestId("try-catch_up").click();
    expect(sendToAgent).toHaveBeenCalledWith(SCENARIOS[1].prompt, expect.any(Function));
    expect(getDemoState().runs).toHaveLength(0);
  });
});

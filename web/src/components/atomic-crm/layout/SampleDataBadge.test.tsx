import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import {
  DropdownMenu,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { SampleDataLine, SampleDataMenuNote } from "./SampleDataBadge";

const inMenu = (mode: string) => (
  <QueryClientProvider client={new QueryClient()}>
    <DropdownMenu open>
      <DropdownMenuContent>
        <SampleDataMenuNote mode={mode} />
        <span>Log out</span>
      </DropdownMenuContent>
    </DropdownMenu>
  </QueryClientProvider>
);

describe("SampleDataMenuNote", () => {
  it("names the limit as the first line of the profile menu on the snapshot build", async () => {
    const screen = await render(inMenu("snapshot"));
    await expect
      .element(screen.getByText("Sample data · read-only"))
      .toBeVisible();
    await expect
      .element(screen.getByText(/Every name and amount is made up/))
      .toBeVisible();
  });

  it("renders nothing on the laptop (local/live)", async () => {
    const screen = await render(inMenu("local"));
    await expect.element(screen.getByText("Log out")).toBeVisible();
    await expect
      .element(screen.getByTestId("sample-data-note"))
      .not.toBeInTheDocument();
  });

  it("phone pages without a menu keep a quiet line on the snapshot build only", async () => {
    const screen = await render(<SampleDataLine mode="snapshot" />);
    await expect.element(screen.getByTestId("sample-data-line")).toBeVisible();
    const local = await render(<SampleDataLine mode="local" />);
    expect(local.container.textContent).toBe("");
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
afterEach(cleanup);
describe("the complete local outreach workflow", () => {
  it("imports the sample, reviews a duplicate, retains gifts, and can undo the merge", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "Import donor list", exact: true }),
    );
    await user.click(
      screen.getByRole("button", { name: /Use our fictional sample/ }),
    );
    const modal = screen.getByRole("dialog");
    expect(
      within(modal).getByText("18 gift rows · 8 donor records"),
    ).toBeTruthy();
    expect(
      within(modal).getByRole("button", { name: /Import & review/ }).disabled,
    ).toBe(true);
    await user.click(within(modal).getByRole("checkbox"));
    await user.click(
      within(modal).getByRole("button", { name: /Import & review/ }),
    );
    await user.click(
      screen.getByRole("button", { name: /1 possible duplicate/ }),
    );
    await user.click(screen.getByRole("button", { name: /Approve merge/ }));
    expect(
      screen.getByRole("heading", { name: "Your review queue is clear" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Back to inbox/ }));
    const detail = screen.getByRole("complementary", {
      name: "Donor briefing",
    });
    expect(within(detail).getByText("$400")).toBeTruthy();
    expect(within(detail).getByText("4 gifts")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Open R. Delgado", exact: true }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Undo merge", exact: true }),
    );
    expect(
      screen.getByRole("button", { name: "Open R. Delgado", exact: true }),
    ).toBeTruthy();
    expect(within(detail).getByText("$300")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Join", exact: true }),
    ).toBeTruthy();
  });
  it("lets staff reject a suggested identity match without merging gifts", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: /1 possible duplicate/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Keep separate", exact: true }),
    );
    await user.click(screen.getByRole("button", { name: /Back to inbox/ }));
    expect(
      screen.getByRole("button", { name: "Open R. Delgado", exact: true }),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole("complementary", { name: "Donor briefing" }),
      ).getByText("$300"),
    ).toBeTruthy();
  });
  it("joins, mutes, leaves a simulated call, and saves the staff outcome", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Join", exact: true }));
    expect(
      screen.getByText(/No microphone, audio, or phone connection/),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Join simulation", exact: true }),
    );
    expect(screen.getByText("You joined the simulation")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Unmute simulation/ }));
    expect(screen.getByText(/Microphone enabled in simulation/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Leave simulation/ }));
    await user.selectOptions(
      screen.getByRole("combobox"),
      "Send volunteer information",
    );
    await user.click(screen.getByRole("button", { name: /Save outcome/ }));
    await user.click(screen.getByRole("button", { name: /Completed/ }));
    await user.click(
      screen.getByRole("button", { name: "Open Elena Moreno", exact: true }),
    );
    expect(
      within(
        screen.getByRole("complementary", { name: "Donor briefing" }),
      ).getByText("Send volunteer information"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Join", exact: true }),
    ).toBeNull();
  });
  it("records an edited draft without sending and supports snooze/restore and search", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: /Prepare a check-in/ }),
    );
    await user.clear(
      screen.getByRole("textbox", { name: "Your message", exact: true }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Your message", exact: true }),
      "Thank you for being part of our community.",
    );
    await user.click(
      screen.getByRole("button", { name: /Approve for staff follow-up/ }),
    );
    expect(
      screen.getByText(/Draft approved for staff follow-up. No message sent/),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole("complementary", { name: "Donor briefing" }),
      ).getByText(/Thank you for being part of our community/),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Restore to inbox/ }));
    await user.click(
      screen.getByRole("button", { name: "Snooze", exact: true }),
    );
    await user.click(screen.getByRole("button", { name: /Snoozed/ }));
    expect(
      screen.getByRole("button", { name: "Open Rosa Delgado", exact: true }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Restore to inbox/ }));
    await user.click(screen.getByRole("button", { name: /Outreach inbox/ }));
    await user.type(
      screen.getByRole("textbox", { name: "Search donors" }),
      "nobodymatches",
    );
    expect(
      screen.getByRole("heading", { name: "No matching people" }),
    ).toBeTruthy();
    await user.click(
      screen.getAllByRole("button", { name: "Clear search", exact: true })[0],
    );
    expect(
      screen.getByRole("button", { name: "Open Rosa Delgado", exact: true }),
    ).toBeTruthy();
  });
});

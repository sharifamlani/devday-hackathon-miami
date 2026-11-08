import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { onboardingStore, type BackgroundRead } from "./onboardingState";
import { DONE_HIDE_MS, TourOffer } from "./TourOffer";

const read = (patch: Partial<BackgroundRead>): BackgroundRead => ({
  status: "running",
  startedAt: "2026-11-08T10:00:00Z",
  finishedAt: null,
  facts: null,
  titles: [],
  detail: null,
  hidden: false,
  ...patch,
});

const setBackground = (background: BackgroundRead) =>
  onboardingStore.dispatch({ type: "update", patch: { background } });

const shownBackground = () => {
  const bg = onboardingStore.get().data.background;
  return bg && !bg.hidden ? bg : null;
};

// Stand-in for the home chat composer: across the bottom with Send and the mic at its right end, like
// HomeChat's; on phones it sits above the bottom navigation bar.
const Composer = ({ onSend, bottom }: { onSend: () => void; bottom: number }) => (
  <div
    style={{
      position: "fixed",
      left: 0,
      right: 0,
      bottom,
      padding: "8px 16px 20px",
      display: "flex",
      justifyContent: "flex-end",
      gap: 6,
    }}
  >
    <button type="button" onClick={onSend}>
      Send
    </button>
    <button type="button" aria-label="Dictate">
      mic
    </button>
  </div>
);

const Status = () => {
  const background = shownBackground();
  return background ? <TourOffer offer={false} /> : null;
};

describe("TourOffer: the background-read status line", () => {
  beforeEach(() => {
    window.localStorage.clear();
    onboardingStore.forget();
  });
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    onboardingStore.forget();
  });

  it.each([
    [1440, 900, 0],
    [390, 844, 72],
  ])("at %ix%i, Send and the mic stay clickable while the read runs (S1, S-neg)", async (w, h, bottom) => {
    await page.viewport(w, h);
    setBackground(read({ status: "running" }));
    const onSend = vi.fn();
    const screen = await render(
      <>
        <Composer onSend={onSend} bottom={bottom} />
        <TourOffer offer={false} />
      </>,
    );
    await expect.element(screen.getByText(/Still reading your website/)).toBeVisible();

    // A real click fails if the card covers the button.
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await userEvent.click(screen.getByRole("button", { name: "Dictate" }));
    expect(onSend).toHaveBeenCalledTimes(1);

    const card = document.querySelector(".onb-offer")!.getBoundingClientRect();
    const send = screen.getByRole("button", { name: "Send" }).element().getBoundingClientRect();
    expect(card.bottom).toBeLessThan(send.top);
  });

  it("can be closed while the read is still running", async () => {
    setBackground(read({ status: "running" }));
    const screen = await render(<Status />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onboardingStore.get().data.background?.hidden).toBe(true);
    await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
  });

  it("hides itself shortly after the read is done (S2)", async () => {
    setBackground(read({ status: "running" }));
    const screen = await render(<Status />);
    await expect.element(screen.getByRole("status")).toBeVisible();

    vi.useFakeTimers();
    setBackground(read({ status: "done", facts: 12, finishedAt: "2026-11-08T10:01:00Z" }));
    await expect.element(screen.getByRole("status")).toHaveTextContent("Your website is read: 12 facts saved.");
    vi.advanceTimersByTime(DONE_HIDE_MS);
    vi.useRealTimers();

    expect(onboardingStore.get().data.background?.hidden).toBe(true);
    await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
  });

  it("keeps a failed read up until it's closed", async () => {
    vi.useFakeTimers();
    setBackground(read({ status: "failed", detail: "We couldn't read your website this time." }));
    const screen = await render(<Status />);
    vi.advanceTimersByTime(DONE_HIDE_MS * 2);
    vi.useRealTimers();
    await expect.element(screen.getByRole("status")).toHaveTextContent("We couldn't read your website this time.");
  });
});

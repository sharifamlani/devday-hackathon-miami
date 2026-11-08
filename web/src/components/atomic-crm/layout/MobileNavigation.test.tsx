import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { MobileNavigation } from "./MobileNavigation";

const calendarLink = (path: string) =>
  new DOMParser()
    .parseFromString(
      renderToString(
        <MemoryRouter initialEntries={[path]}>
          <MobileNavigation />
        </MemoryRouter>,
      ),
      "text/html",
    )
    .querySelector<HTMLAnchorElement>('a[href="/calendar"]');

describe("MobileNavigation", () => {
  it("links to the calendar, like the desktop rail", () => {
    const link = calendarLink("/");
    expect(link?.textContent).toBe("Calendar");
    expect(link?.getAttribute("aria-current")).toBeNull();
  });

  it("marks Calendar as the current page on /calendar", () => {
    expect(calendarLink("/calendar")?.getAttribute("aria-current")).toBe("page");
  });
});

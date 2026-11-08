import { renderToString } from "react-dom/server";

import type { DonorDetail } from "../providers/local/types";
import { GivingPanel } from "./GivingPanel";

const gift = (
  id: number,
  gift_date: string,
  amount: number,
  status = "ok",
) => ({
  id,
  amount,
  gift_date,
  channel: null,
  fund_type: null,
  status,
});

const donor = (gifts: ReturnType<typeof gift>[]) =>
  ({
    id: 63,
    full_name: "Hye-jin Park",
    gifts,
    usual_cadence: "monthly",
    fund_type: null,
    is_sample: false,
  }) as unknown as DonorDetail;

describe("GivingPanel with a declined charge", () => {
  it("shows the server's lifetime and labels the declined charge, not a gift", () => {
    const html = renderToString(
      <GivingPanel
        donor={donor([
          gift(1, "2026-10-10", 40, "declined"),
          gift(2, "2026-09-10", 40),
          gift(3, "2025-11-20", 400),
        ])}
      />,
    );
    expect(html).toContain("$440"); // 40 + 400; the declined $40 is not counted
    expect(html).not.toContain("$480");
    expect(html).toContain("Declined");
    expect(html).toContain("not a gift");
  });

  it("labels a gift recorded on both people 'Counted once', not 'Declined'", () => {
    const html = renderToString(
      <GivingPanel
        donor={donor([
          gift(1, "2026-10-10", 40, "duplicate"),
          gift(2, "2026-09-10", 40),
          gift(3, "2025-11-20", 400),
        ])}
      />,
    );
    expect(html).toContain("Counted once");
    expect(html).not.toContain("Declined");
    expect(html).not.toContain("not a gift");
  });

  it("a donor with no declined charges is unchanged", () => {
    const html = renderToString(
      <GivingPanel
        donor={donor([gift(2, "2026-09-10", 40), gift(3, "2025-11-20", 400)])}
      />,
    );
    expect(html).toContain("$440");
    expect(html).not.toContain("Declined");
  });
});

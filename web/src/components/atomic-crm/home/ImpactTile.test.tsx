import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { ImpactTile } from "./HomeCards";

const html = (n: number) =>
  renderToString(
    <MemoryRouter>
      <ImpactTile factCount={n} />
    </MemoryRouter>,
  );

describe("ImpactTile", () => {
  it("previews the fact count and links to the Impact panel", () => {
    const out = html(13);
    expect(out).toContain("13 sourced facts");
    expect(out).toContain("Copy for a grant report");
    expect(out).toContain("workspace=impact");
  });

  it("with no facts invites reading the website and still links", () => {
    const out = html(0);
    expect(out).toContain("Read your website to collect stories");
    expect(out).toContain("workspace=impact");
  });
});

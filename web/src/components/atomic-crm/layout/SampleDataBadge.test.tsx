import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";

import { SampleDataBadge } from "./SampleDataBadge";

const html = (mode: string) =>
  renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <SampleDataBadge mode={mode} />
    </QueryClientProvider>,
  );

describe("SampleDataBadge", () => {
  it("marks the snapshot build as sample data", () => {
    expect(html("snapshot")).toContain("Sample data");
    expect(html("snapshot")).toContain("Not real donor records");
  });

  it("renders nothing on the laptop (local/live)", () => {
    expect(html("local")).toBe("");
  });
});

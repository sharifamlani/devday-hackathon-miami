import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { PhoneCallInline } from "./PhoneCallDialog";

const render = () =>
  renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <PhoneCallInline donorId={19} onClose={() => {}} />
    </QueryClientProvider>,
  );

describe("PhoneCallInline: the call inside the agent's call sheet", () => {
  it("renders in place, not as a dialog over the page", () => {
    const html = render();
    expect(html).toContain('data-testid="inline-call"');
    expect(html).not.toContain('role="dialog"');
  });

  it("checks the phone setup first, and Call stays disabled until it is ready", () => {
    const html = render().replace(/<!-- -->/g, "");
    expect(html).toContain("Checking the phone setup");
    expect(html).toContain("Cancel</button>");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Call<\/button>/s);
  });
});

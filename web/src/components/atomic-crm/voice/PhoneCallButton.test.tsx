import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type * as PhoneApi from "../providers/local/phone";
import { PhoneCallButton } from "./PhoneCallButton";

// The dialog asks the service whether a call can be placed; answer as a ready preview, and never start a call.
vi.mock("../providers/local/phone", async (importOriginal) => ({
  ...(await importOriginal<typeof PhoneApi>()),
  previewPhoneCall: vi.fn(async (donorId: number) => ({
    ready: true,
    reason: null,
    donor_id: donorId,
    donor_name: "James Carter",
    donor_phone: "+1 (305) 555-0142",
    staff_phone: "+1 (305) 555-0100",
    notice: "Hello. This call is recorded for our notes.",
  })),
  startPhoneCall: vi.fn(),
}));

const wrap = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
);

describe("PhoneCallButton (donor header)", () => {
  it("renders nothing outside local mode (the Vercel snapshot can't place calls)", async () => {
    const screen = await render(wrap(<PhoneCallButton donorId={3} mode="snapshot" />));
    expect(screen.container.querySelector("button")).toBeNull();
  });

  it("in local mode, opens the call dialog for that donor", async () => {
    const screen = await render(wrap(<PhoneCallButton donorId={3} mode="local" />));
    await screen.getByRole("button", { name: "Call" }).click();
    await expect.element(screen.getByRole("dialog")).toBeVisible();
    await expect.element(screen.getByText("Call James Carter")).toBeVisible();
    await expect.element(screen.getByText(/\+1 \(305\) 555-0142/)).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Call", exact: true }).last()).toBeEnabled();
  });
});

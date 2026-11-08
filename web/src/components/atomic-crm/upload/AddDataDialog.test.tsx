import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const uploadFiles = vi.hoisted(() => vi.fn());
vi.mock("../providers/local", () => ({
  DATA_MODE: "local",
  donorDeskMethods: {
    uploadFiles: (...args: unknown[]) => uploadFiles(...args),
  },
}));

const { AddDataDialog } = await import("./AddDataDialog");
const { AddDataButton } = await import("./AddDataButton");

const withClient = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);
const csv = () =>
  new File(["Name,Amount\nA B,5"], "nov15.csv", { type: "text/csv" });

beforeEach(() => {
  uploadFiles.mockReset();
});

describe("AddDataDialog", () => {
  it("walks empty, files chosen, processing, results, then Done closes", async () => {
    let finish: (v: unknown) => void = () => {};
    uploadFiles.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const onOpenChange = vi.fn();
    const screen = await render(
      withClient(<AddDataDialog open onOpenChange={onOpenChange} />),
    );

    await expect
      .element(screen.getByText("Drop your files here"))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /^Upload/ }))
      .not.toBeInTheDocument();

    await screen
      .getByLabelText("Choose files")
      .upload([csv(), new File(["x"], "photo.png")]);
    await expect.element(screen.getByText("nov15.csv")).toBeVisible();
    await expect.element(screen.getByText(/photo\.png/)).toBeVisible(); // skipped, with its reason
    await expect
      .element(screen.getByText(/Gatherly reads \.xlsx/))
      .toBeVisible();

    await screen.getByRole("button", { name: "Upload 1 file" }).click();
    await expect
      .element(screen.getByText("Bringing your data together."))
      .toBeVisible();

    finish({ donors: 5, gifts: 5, duplicates: 0, message: null, raw: {} });
    await expect
      .element(screen.getByText("Your data is added."), { timeout: 10_000 })
      .toBeVisible();
    await expect.element(screen.getByText("Accounts recognized")).toBeVisible();
    await screen.getByRole("button", { name: "Done" }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the error state with a retry", async () => {
    uploadFiles.mockImplementation(async () => {
      throw new Error("Ingest said no.");
    });
    const screen = await render(
      withClient(<AddDataDialog open onOpenChange={() => {}} />),
    );
    await screen.getByLabelText("Choose files").upload([csv()]);
    await screen.getByRole("button", { name: "Upload 1 file" }).click();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Ingest said no.");
    await expect
      .element(screen.getByRole("button", { name: "Try again" }))
      .toBeVisible();
  });
});

describe("AddDataButton", () => {
  it("opens the dialog in local mode, with the tooltip", async () => {
    const screen = await render(withClient(<AddDataButton local />));
    const button = screen.getByRole("button", { name: "Add data" });
    await expect.element(button).toBeEnabled();
    await expect
      .element(button)
      .toHaveAttribute(
        "title",
        "Add data: spreadsheets, notes, sign-in sheets",
      );
    await button.click();
    await expect
      .element(screen.getByText("Drop your files here"))
      .toBeVisible();
  });

  it("is disabled outside local mode and says why", async () => {
    const screen = await render(withClient(<AddDataButton local={false} />));
    const button = screen.getByRole("button", { name: "Add data" });
    await expect.element(button).toBeDisabled();
    await expect
      .element(button)
      .toHaveAttribute("title", "Uploads need the local service");
  });
});

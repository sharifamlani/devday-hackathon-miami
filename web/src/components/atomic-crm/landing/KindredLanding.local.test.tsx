import { render } from "vitest-browser-react";

import { KindredLanding } from "./KindredLanding";

// Local mode: the landing uploads the real sample files to POST /ingest.
const uploadFiles = vi.fn();
vi.mock("../providers/local", () => ({
  DATA_MODE: "local",
  donorDeskMethods: { uploadFiles: (...args: unknown[]) => uploadFiles(...args) },
}));

const manifest = {
  files: [
    { name: "give_miami_day_export_2022-2025.xlsx", bytes: 9869 },
    { name: "board_retreat_notes.md", bytes: 2106 },
  ],
};

describe("Try sample data (local mode)", () => {
  beforeEach(() => {
    uploadFiles.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("manifest.json")
          ? new Response(JSON.stringify(manifest))
          : new Response(`contents of ${url}`),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("Go uploads every sample file and shows the import summary", async () => {
    uploadFiles.mockResolvedValue({ donors: 33, gifts: 120, duplicates: 6, message: null, raw: {} });
    const screen = await render(<KindredLanding />);
    await screen.getByRole("button", { name: "Try sample data" }).click();
    await screen.getByRole("button", { name: "Go" }).click();

    await expect.element(screen.getByText("Your sample files are in.")).toBeVisible();
    await expect.element(screen.getByText("33 donors · 120 gifts · 6 possible duplicates")).toBeVisible();
    await expect.element(screen.getByRole("link", { name: "Open the CRM" })).toBeVisible();

    expect(uploadFiles).toHaveBeenCalledTimes(1);
    const [files, target] = uploadFiles.mock.calls[0] as [File[], unknown];
    expect(files.map((f) => f.name)).toEqual([
      "give_miami_day_export_2022-2025.xlsx",
      "board_retreat_notes.md",
    ]);
    expect(files[0].type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(target).toBeUndefined(); // the data layer's default: the agent sorts
  });

  it("shows the error and points to the example files, not a cached workspace, when ingest isn't running", async () => {
    uploadFiles.mockRejectedValue(
      new Error("Upload isn't available yet: the ingest service is not running."),
    );
    const screen = await render(<KindredLanding />);
    await screen.getByRole("button", { name: "Try sample data" }).click();
    await screen.getByRole("button", { name: "Go" }).click();

    await expect
      .element(screen.getByText("Upload isn't available yet: the ingest service is not running."))
      .toBeVisible();
    await expect.element(screen.getByText(/You can also drag the example files/)).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Open the cached sample workspace instead" }))
      .not.toBeInTheDocument();
  });
});

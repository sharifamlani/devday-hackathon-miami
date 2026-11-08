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

  it("imports every sample file straight away and shows the processing screen", async () => {
    uploadFiles.mockResolvedValue({ donors: 33, gifts: 120, duplicates: 6, message: null, raw: {} });
    const screen = await render(<KindredLanding />);
    await screen.getByRole("button", { name: "Try sample data" }).click();

    await expect
      .element(screen.getByRole("button", { name: "Create organization profile" }))
      .toBeVisible();
    expect(uploadFiles).toHaveBeenCalledTimes(1);
    const [files, target] = uploadFiles.mock.calls[0] as [File[], unknown];
    expect(files.map((f) => f.name)).toEqual([
      "give_miami_day_export_2022-2025.xlsx",
      "board_retreat_notes.md",
    ]);
    expect(files[0].type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(target).toBeUndefined(); // the data layer's default: the agent sorts
  });

  it("shows the error on the landing when ingest isn't running", async () => {
    uploadFiles.mockRejectedValue(
      new Error("Upload isn't available yet: the ingest service is not running."),
    );
    const screen = await render(<KindredLanding />);
    await screen.getByRole("button", { name: "Try sample data" }).click();

    await expect
      .element(screen.getByText("Upload isn't available yet: the ingest service is not running."))
      .toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Try sample data" })).toBeVisible();
  });
});

describe("Dropping the sample folder (local mode)", () => {
  // Every file in data/sample_inputs/: 8 inputs plus the answer key and the README.
  const TYPES: Record<string, string> = {
    md: "text/markdown", json: "application/json", csv: "text/csv",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  const SAMPLE_FOLDER = [
    "_README.md", "answer_key.json", "board_retreat_notes.md", "check_deposit_log_q3_2026.docx",
    "community_intake_forms_2026.docx", "donor_intake_forms_2026.docx", "event_signin_sheet_nov1.xlsx",
    "give_miami_day_export_2022-2025.xlsx", "online_gifts_oct_nov_2026.xlsx", "stock_and_daf_grants.docx",
  ];

  beforeEach(() => uploadFiles.mockReset());

  it("sends only the 8 input files, skipping the answer key and the README like onboarding does", async () => {
    const { skipReason } = await import("../onboarding/firstRun");
    uploadFiles.mockResolvedValue({ donors: 33, gifts: 120, duplicates: 6, message: null, raw: {} });
    const screen = await render(<KindredLanding />);
    const files = SAMPLE_FOLDER.map(
      (n) => new File([`contents of ${n}`], n, { type: TYPES[n.split(".").pop() ?? ""] }),
    );
    await screen.getByLabelText("Choose donor files").upload(files);

    await expect.element(screen.getByText(/Skipped \(not donor data\): .*_README\.md/)).toBeVisible();
    await expect.element(screen.getByText(/Skipped \(not donor data\): .*answer_key\.json/)).toBeVisible();
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Import donor data" }).click();

    expect(uploadFiles).toHaveBeenCalledTimes(1);
    const sent = (uploadFiles.mock.calls[0] as [File[]])[0].map((f) => f.name);
    expect(sent).toHaveLength(8);
    expect([...sent].sort()).toEqual(SAMPLE_FOLDER.filter((name) => skipReason({ name, size: 1 }) === null).sort());
  });
});

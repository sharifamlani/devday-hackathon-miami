import { describe, expect, it } from "vitest";
import {
  countSourceFiles,
  sourceFiles,
  sourceMatchesFile,
} from "./sourceFiles";

const multi =
  "board_retreat_notes.md: line:18; give_miami_day_export_2022-2025.xlsx: sheet:Online:row:26; board_retreat_notes.md: line:40";

describe("sourceFiles", () => {
  it("keeps distinct file names, drops line and row provenance", () => {
    expect(sourceFiles(multi)).toEqual([
      "board_retreat_notes.md",
      "give_miami_day_export_2022-2025.xlsx",
    ]);
  });
  it("keeps plain labels whole", () => {
    expect(sourceFiles("Sample data")).toEqual(["Sample data"]);
    expect(sourceFiles("donors_2024.csv")).toEqual(["donors_2024.csv"]);
    expect(sourceFiles("")).toEqual([]);
  });
  it("counts a donor toward each file it was seen in", () => {
    expect(
      countSourceFiles([multi, "board_retreat_notes.md: line:2"]),
    ).toEqual([
      ["board_retreat_notes.md", 2],
      ["give_miami_day_export_2022-2025.xlsx", 1],
    ]);
  });
  it("matches by file", () => {
    expect(sourceMatchesFile(multi, "board_retreat_notes.md")).toBe(true);
    expect(sourceMatchesFile(multi, "other.csv")).toBe(false);
  });
});

/**
 * A donor's `source` is provenance text, e.g.
 * "board_retreat_notes.md: line:18; give_miami_day_export_2022-2025.xlsx: sheet:Online:row:26".
 * The filter shows only the distinct file names.
 */
const FILE_AT_START = /^\s*([^:;]+?\.[A-Za-z0-9]{1,5})\s*(?::|$)/;

export const sourceFiles = (source: string | null | undefined): string[] => {
  const raw = (source ?? "").trim();
  if (!raw) return [];
  const files = raw
    .split(";")
    .map((part) => FILE_AT_START.exec(part)?.[1]?.trim())
    .filter((f): f is string => !!f);
  // "Sample data", "Not recorded": no file in it, so the whole label is the source.
  return files.length ? [...new Set(files)] : [raw];
};

/** Does this donor's source mention the file (or equal the label)? */
export const sourceMatchesFile = (
  source: string | null | undefined,
  file: string,
): boolean => sourceFiles(source).includes(file);

/** [file, donors seen in it], sorted by name; a donor in several files counts toward each. */
export const countSourceFiles = (
  sources: (string | null | undefined)[],
): [string, number][] => {
  const counts = new Map<string, number>();
  for (const s of sources)
    for (const f of sourceFiles(s)) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
};

/**
 * The fictional sample inputs served from public/sample/ (copied there by
 * web/scripts/copy-sample-inputs.mjs, which never copies the answer key).
 * Paths are relative so they work under any deployment sub-path.
 */
export const SAMPLE_BASE = "./sample/";
export const DEMO_DATA_BASE = "./demo-data/";

export interface SampleFile {
  name: string;
  bytes: number;
}

const MIME: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown",
  csv: "text/csv",
  txt: "text/plain",
};

export const loadSampleManifest = async (
  base = SAMPLE_BASE,
): Promise<SampleFile[]> => {
  const response = await fetch(`${base}manifest.json`);
  if (!response.ok) throw new Error("The sample files couldn't be loaded.");
  const manifest = (await response.json()) as { files?: SampleFile[] };
  // Belt and braces: the copy script already refuses it.
  return (manifest.files ?? []).filter((f) => !/answer[_-]?key/i.test(f.name));
};

/** Fetch each sample file and wrap it as a File, ready for uploadFiles. */
export const loadSampleFiles = (
  files: SampleFile[],
  base = SAMPLE_BASE,
): Promise<File[]> =>
  Promise.all(
    files.map(async ({ name }) => {
      const response = await fetch(`${base}${encodeURIComponent(name)}`);
      if (!response.ok) throw new Error(`The sample file ${name} couldn't be loaded.`);
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      return new File([await response.blob()], name, {
        type: MIME[ext] ?? "application/octet-stream",
      });
    }),
  );

export const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;

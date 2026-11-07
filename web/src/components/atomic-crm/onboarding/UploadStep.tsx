import { useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { useDropzone } from "react-dropzone";

import { Button } from "@/components/ui/button";
import { loadSampleFiles, loadSampleManifest } from "../landing/sampleFiles";
import { DATA_MODE } from "../providers/local/config";
import type { UploadTarget } from "../providers/local/crmTypes";
import { useUploadFiles } from "../providers/local/hooks";
import { useServes } from "../shell/useServes";
import { ImportSummary } from "./ImportSummary";

const TARGETS: { value: UploadTarget; label: string; hint: string }[] = [
  { value: "auto", label: "Let the agent sort them", hint: "A gift → Givers, an intake or service record → Community, anyone else → Neighbors. Unclear ones come back for your call." },
  { value: "giver", label: "Givers", hint: "Everyone in these files has given." },
  { value: "neighbor", label: "Neighbors", hint: "People you’ve met who haven’t given or used services yet." },
  { value: "community", label: "Community", hint: "People the nonprofit helps." },
];

const ACCEPT = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/markdown": [".md"],
  "text/csv": [".csv"],
};

/** Step 1: drop files (or use the samples), pick a tab or let the agent sort, import. */
export const UploadStep = ({ onNext }: { onNext: () => void }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [target, setTarget] = useState<UploadTarget>("auto");
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [sampleError, setSampleError] = useState("");
  const [cachedRun, setCachedRun] = useState(false);
  const upload = useUploadFiles();
  const canUpload = DATA_MODE === "local";
  const servesIngest = useServes("POST", "/ingest");
  const ingestMissing = canUpload && servesIngest === false;

  const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
    accept: ACCEPT,
    multiple: true,
    noClick: true,
    onDrop: (accepted) => {
      upload.reset();
      setFiles((current) => [
        ...current,
        ...accepted.filter((f) => !current.some((c) => c.name === f.name)),
      ]);
    },
  });

  const loadSamples = async () => {
    setLoadingSamples(true);
    setSampleError("");
    try {
      setFiles(await loadSampleFiles(await loadSampleManifest()));
      setTarget("auto");
    } catch (cause) {
      setSampleError((cause as Error).message);
    } finally {
      setLoadingSamples(false);
    }
  };

  const go = () => {
    if (!files.length) return;
    if (!canUpload) {
      setCachedRun(true);
      return;
    }
    upload.mutate({ files, target });
  };

  const done = upload.isSuccess || cachedRun;

  return (
    <section aria-labelledby="upload-title" className="space-y-5">
      <div>
        <h2 id="upload-title" className="text-xl font-semibold">1. Upload your data</h2>
        <p className="text-sm text-muted-foreground">
          Spreadsheets, Word documents, notes. Messy is fine: the import agent reads them.
        </p>
      </div>

      <div
        {...getRootProps({
          className: `rounded-[22px] border-2 border-dashed p-6 text-center ${isDragActive ? "border-primary bg-accent" : "border-border"}`,
          "aria-label": "File drop area",
        })}
      >
        <input {...getInputProps({ "aria-label": "Choose files" })} />
        <Upload className="mx-auto mb-2 size-6 text-muted-foreground" aria-hidden />
        <p className="text-sm">{isDragActive ? "Drop the files here" : "Drag files here (.xlsx, .docx, .md, .csv)"}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Button type="button" variant="outline" onClick={open}>Choose files</Button>
          <Button type="button" variant="ghost" onClick={() => void loadSamples()} disabled={loadingSamples}>
            {loadingSamples ? "Loading sample files…" : "Try sample data"}
          </Button>
        </div>
        {sampleError && <p role="alert" className="mt-2 text-sm text-destructive">{sampleError}</p>}
      </div>

      {files.length > 0 && (
        <ul className="space-y-1.5" aria-label="Files to import">
          {files.map((file) => (
            <li key={file.name} className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
              <FileText className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="text-muted-foreground">{Math.max(1, Math.round(file.size / 1024))} KB</span>
              {!done && (
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles((current) => current.filter((f) => f !== file))}
                  className="rounded p-1 hover:bg-background"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <fieldset className="space-y-2" disabled={done || upload.isPending}>
        <legend className="mb-1 text-sm font-medium">Where do they go?</legend>
        {TARGETS.map((t) => (
          <label key={t.value} className="flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm has-[:checked]:border-primary">
            <input
              type="radio"
              name="upload-target"
              value={t.value}
              checked={target === t.value}
              onChange={() => setTarget(t.value)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{t.label}</span>
              <span className="block text-muted-foreground">{t.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {ingestMissing && (
        <p className="text-sm text-muted-foreground">
          Upload isn’t available yet: the import service (POST /ingest) isn’t running on this API build.
        </p>
      )}
      {!done && (
        <Button onClick={go} disabled={!files.length || upload.isPending || ingestMissing}>
          {upload.isPending ? "Reading your files…" : `Import ${files.length || ""} file${files.length === 1 ? "" : "s"}`.replace("  ", " ")}
        </Button>
      )}
      {upload.isError && <p role="alert" className="text-sm text-destructive">{upload.error.message}</p>}

      {done && (
        <div className="space-y-3 rounded-[22px] bg-card p-4">
          <h3 className="font-semibold">{cachedRun ? "Sample run (cached)" : "Imported"}</h3>
          {cachedRun && (
            <p className="text-sm text-muted-foreground">
              This preview can’t import files, so the numbers below are the cached sample workspace, not these files.
            </p>
          )}
          <ImportSummary result={upload.data ?? null} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={onNext}>Next: where you are online</Button>
            <Button variant="outline" nativeButton={false} render={<a href="#/people" />}>Open People</Button>
          </div>
        </div>
      )}
    </section>
  );
};

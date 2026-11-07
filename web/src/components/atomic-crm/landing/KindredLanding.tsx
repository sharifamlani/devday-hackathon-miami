import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { FileText, Upload } from "lucide-react";
import { useDropzone } from "react-dropzone";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { DATA_MODE, donorDeskMethods } from "../providers/local";
import type { IngestResult } from "../providers/local/types";
import "./kindred-landing.css";
import {
  formatBytes,
  loadSampleFiles,
  loadSampleManifest,
  type SampleFile,
} from "./sampleFiles";

const subscribeToHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const getHash = () => window.location.hash;

/** Keep existing workspace deep links; the bare app URL opens the landing page. */
export const KindredLandingGate = ({ children }: { children: ReactNode }) => {
  const hash = useSyncExternalStore(subscribeToHash, getHash, () => "");
  return hash === "" || hash === "#/welcome" ? <KindredLanding /> : children;
};

export const KindredLanding = () => {
  const [isUploadOpen, setUploadOpen] = useState(false);
  const [isSampleOpen, setSampleOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<IngestResult | null>(null);
  const canUpload = DATA_MODE === "local";
  const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
    accept: { "text/csv": [".csv"] },
    multiple: false,
    noClick: true,
    noKeyboard: true,
    disabled: pending,
    onDrop: (accepted, rejected) => {
      setResult(null);
      setError("");
      if (canUpload) {
        setFile(accepted[0] ?? null);
        if (rejected.length) setError("Please choose one CSV file at a time.");
      }
      setUploadOpen(true);
    },
  });

  const importDonors = async () => {
    if (!canUpload || !file || pending) return;
    setPending(true);
    setError("");
    try {
      setResult(await donorDeskMethods.uploadFiles([file]));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "We couldn’t import this file. Please try again.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="kindred-landing" aria-labelledby="kindred-heading">
      <div className="kindred-landing-content">
        <p className="kindred-wordmark">kindred</p>
        <h1 id="kindred-heading" className="kindred-headline">
          <span>Less time on tasks.</span>
          <strong>More time for people.</strong>
        </h1>
        <p className="kindred-subtitle">
          Your mission deserves more of your time.
        </p>
        <div
          {...getRootProps({
            className: `kindred-dropzone${isDragActive ? " is-dragging" : ""}`,
            role: "group",
            "aria-label": "Donor CSV drop area",
          })}
        >
          <input
            {...getInputProps({
              "aria-label": "Choose donor CSV",
              disabled: !canUpload || pending,
            })}
          />
          <button
            className="kindred-upload"
            type="button"
            onClick={() => {
              setResult(null);
              setError("");
              if (canUpload) open();
              else setUploadOpen(true);
            }}
          >
            <Upload aria-hidden="true" size={23} strokeWidth={1.7} />
            Upload donor data
          </button>
          <p className="kindred-file-hint" aria-live="polite">
            {isDragActive
              ? "Drop your CSV here"
              : "or drag and drop your CSV here"}
          </p>
        </div>
        <button
          className="kindred-sample"
          type="button"
          onClick={() => setSampleOpen(true)}
        >
          Try sample data
        </button>
        <ol className="kindred-steps" aria-label="How Kindred works">
          <li>Upload your list</li>
          <li>Understand your donors</li>
          <li>Reach out thoughtfully</li>
        </ol>
      </div>

      <Dialog
        open={isUploadOpen}
        onOpenChange={(open) => {
          if (!pending) setUploadOpen(open);
        }}
      >
        <DialogContent className="kindred-import" showCloseButton={!pending}>
          <DialogTitle>
            {result ? "Your donor list is ready." : "Bring your donor list."}
          </DialogTitle>
          <DialogDescription>
            {result
              ? "Open your workspace to review donors and possible duplicates."
              : canUpload
                ? "Choose a CSV file to import into your donor workspace. Use sample data for this demo."
                : "This preview uses sample data. File uploads are available when the local donor service is connected."}
          </DialogDescription>

          {canUpload && !result && (
            <form
              className="kindred-import-form"
              onSubmit={(event) => {
                event.preventDefault();
                void importDonors();
              }}
            >
              <label htmlFor="kindred-csv">Donor CSV file</label>
              <input
                id="kindred-csv"
                type="file"
                accept=".csv,text/csv"
                required={!file}
                disabled={pending}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setError("");
                }}
              />
              {file && <p role="status">Selected: {file.name}</p>}
              {error && <p role="alert">{error}</p>}
              <button
                className="kindred-upload"
                type="submit"
                disabled={!file || pending}
              >
                {pending ? "Importing your list…" : "Import donor data"}
              </button>
              <span role="status" className="sr-only">
                {pending ? "Import in progress. Please wait." : ""}
              </span>
            </form>
          )}
          <a className="kindred-workspace-link" href="#/">
            {result ? "View donor workspace" : "Explore sample workspace"}
          </a>
        </DialogContent>
      </Dialog>
      <SampleDialog open={isSampleOpen} onOpenChange={setSampleOpen} />
    </main>
  );
};

/** "12 donors · 47 gifts · 3 possible duplicates", from whatever ingest reported. */
const summarize = (result: IngestResult) => {
  const parts = [
    result.donors != null ? `${result.donors} donors` : null,
    result.gifts != null ? `${result.gifts} gifts` : null,
    result.duplicates != null ? `${result.duplicates} possible duplicates` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : (result.message ?? "Your files were imported.");
};

/**
 * "Try sample data": pre-loads the fictional sample files and waits for Go.
 * Local mode uploads them to POST /ingest (the agent sorts them); the snapshot
 * build can't import, so it says so and opens the cached sample workspace.
 */
const SampleDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [files, setFiles] = useState<SampleFile[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<IngestResult | null>(null);
  const [cachedRun, setCachedRun] = useState(false);
  const canUpload = DATA_MODE === "local";

  useEffect(() => {
    if (!open || files) return;
    loadSampleManifest()
      .then(setFiles)
      .catch((cause: Error) => setError(cause.message));
  }, [open, files]);

  const go = async () => {
    if (!files?.length || pending) return;
    setError("");
    if (!canUpload) {
      setCachedRun(true);
      return;
    }
    setPending(true);
    try {
      // No target: uploadFiles defaults to "auto", the agent sorts them.
      setResult(await donorDeskMethods.uploadFiles(await loadSampleFiles(files)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t import the sample files.");
    } finally {
      setPending(false);
    }
  };

  const done = result != null || cachedRun;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="kindred-import" showCloseButton={!pending}>
        <DialogTitle>
          {result
            ? "Your sample files are in."
            : cachedRun
              ? "Sample run (cached)"
              : "Sample files, ready to go."}
        </DialogTitle>
        <DialogDescription>
          {result
            ? summarize(result)
            : cachedRun
              ? "This preview can’t import files, so it opens a cached sample workspace instead. It wasn’t built from these files."
              : "Fictional records for a Miami nonprofit: every name, email and amount is invented."}
        </DialogDescription>

        {!done && (
          <>
            {files ? (
              <ul className="kindred-sample-files" aria-label="Sample files">
                {files.map((file) => (
                  <li key={file.name}>
                    <FileText aria-hidden="true" size={16} strokeWidth={1.7} />
                    <span className="kindred-sample-name">{file.name}</span>
                    <span className="kindred-sample-size">{formatBytes(file.bytes)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              !error && <p role="status">Loading the sample files…</p>
            )}
            <p className="kindred-sample-target">
              Where they go: <strong>Let the agent sort them</strong>
            </p>
            {error && <p role="alert">{error}</p>}
            <button
              className="kindred-upload"
              type="button"
              onClick={() => void go()}
              disabled={!files?.length || pending}
            >
              {pending ? "Reading your files…" : "Go"}
            </button>
            <span role="status" className="sr-only">
              {pending ? "Import in progress. Please wait." : ""}
            </span>
          </>
        )}

        {(done || (error && canUpload && files)) && (
          <a className="kindred-workspace-link" href="#/">
            {done ? "Open the CRM" : "Open the cached sample workspace instead"}
          </a>
        )}
      </DialogContent>
    </Dialog>
  );
};

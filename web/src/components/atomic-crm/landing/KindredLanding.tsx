import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { FileText, Pause, Play, Upload } from "lucide-react";
import { useDropzone } from "react-dropzone";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useOnboarding } from "../onboarding/onboardingState";
import { DATA_MODE, donorDeskMethods } from "../providers/local";
import { SAMPLE_BUILD } from "../providers/local/config";
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

/** Keep workspace hash routes; the bare app URL is always the landing page. */
export const KindredLandingGate = ({ children }: { children: ReactNode }) => {
  const hash = useSyncExternalStore(subscribeToHash, getHash, () => "");
  if (hash === "#/welcome") return <KindredLanding />;
  if (hash !== "") return children;
  return <KindredLanding />;
};

/**
 * Files that aren't donor data: the answer key, READMEs and hidden files. The same rule as onboarding
 * (onboarding/firstRun.ts skipReason) minus its extension check, since the landing also takes .txt.
 * /ingest reads .json and .md, so without this the answer key and the README would be imported as data.
 */
const isNotDonorData = (name: string) =>
  /answer[_-]?key/i.test(name) || /^_?readme\b/i.test(name) || name.startsWith(".");

const splitDonorFiles = (incoming: File[]) => ({
  keep: incoming.filter((f) => !isNotDonorData(f.name)),
  skipped: incoming.filter((f) => isNotDonorData(f.name)).map((f) => f.name),
});

/** The files the app can read; the landing accepts all of them. */
const ACCEPTED_FILES = ".csv,.xlsx,.docx,.md,.txt";
const ACCEPTED_TYPES = {
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "text/markdown": [".md"],
  "text/plain": [".txt"],
};

/** Seconds since `active` turned true, so a 40-second ingest shows it is alive. */
const useElapsed = (active: boolean) => {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const timer = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return seconds;
};

export const KindredLanding = () => {
  const [areColorsPaused, setColorsPaused] = useState(false);
  const [isUploadOpen, setUploadOpen] = useState(false);
  const [isSampleOpen, setSampleOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const chooseFiles = (incoming: File[]) => {
    const { keep, skipped: left } = splitDonorFiles(incoming);
    setFiles(keep);
    setSkipped(left);
  };
  const [pending, setPending] = useState(false);
  const elapsed = useElapsed(pending);
  const [error, setError] = useState("");
  const [result, setResult] = useState<IngestResult | null>(null);
  const canUpload = DATA_MODE === "local";
  const startOnboarding = () => {
    // React Admin uses a hash router. The force flag starts at step one even
    // when this browser completed setup during an earlier demo run.
    window.location.hash = "#/?onboarding=1";
  };
  const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
    accept: ACCEPTED_TYPES,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    disabled: pending,
    onDrop: (accepted, rejected) => {
      setResult(null);
      setError("");
      if (canUpload) {
        chooseFiles(accepted);
        // The answer key (.json) is refused by type too: list it as skipped, not as a wrong file
        const wrong = rejected.filter((r) => !isNotDonorData(r.file.name));
        const notData = rejected.filter((r) => isNotDonorData(r.file.name)).map((r) => r.file.name);
        if (notData.length) setSkipped((s) => [...s, ...notData]);
        if (wrong.length)
          setError("Please choose .csv, .xlsx, .docx, .md or .txt files.");
      }
      setUploadOpen(true);
    },
  });

  const importDonors = async () => {
    if (!canUpload || !files.length || pending) return;
    setPending(true);
    setError("");
    try {
      setResult(await donorDeskMethods.uploadFiles(files));
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
    <main
      className={`kindred-landing${areColorsPaused ? " colors-paused" : ""}`}
      aria-labelledby="kindred-heading"
    >
      <div className="kindred-landing-content">
        {DATA_MODE === "snapshot" && (
          <div className="fixed right-4 top-4 z-10">
            <Badge
              variant="outline"
              title="Read-only sample export. Not real donor records."
              aria-label="Sample data. Read-only sample export. Not real donor records."
              data-testid="sample-data-badge"
            >
              Sample data
            </Badge>
          </div>
        )}
        <p className="kindred-wordmark">kindred</p>
        <h1 id="kindred-heading" className="kindred-headline">
          <span>Less time on tasks.</span>
          <strong>More time for people.</strong>
        </h1>
        <p className="kindred-subtitle">
          Your mission deserves more of your time.
        </p>
        <button
          className="kindred-upload kindred-start"
          type="button"
          onClick={startOnboarding}
        >
          Get started
        </button>
        <div
          {...getRootProps({
            className: `kindred-dropzone${isDragActive ? " is-dragging" : ""}`,
            role: "group",
            "aria-label": "Donor file drop area",
          })}
        >
          <input
            {...getInputProps({
              "aria-label": "Choose donor files",
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
              ? "Drop your files here"
              : "or drag and drop your files here (CSV, Excel, Word, notes)"}
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

      <button
        className="kindred-motion-toggle"
        type="button"
        onClick={() => setColorsPaused((paused) => !paused)}
        aria-pressed={areColorsPaused}
        aria-label="Pause background colors"
      >
        {areColorsPaused ? (
          <Play size={13} aria-hidden="true" />
        ) : (
          <Pause size={13} aria-hidden="true" />
        )}
        {areColorsPaused ? "Resume colors" : "Pause colors"}
      </button>

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
                ? "Choose the files to import into your donor workspace: CSV, Excel, Word or notes. To try the app, use the example files in data/sample_inputs/."
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
              <label htmlFor="kindred-csv">Donor files</label>
              <input
                id="kindred-csv"
                type="file"
                multiple
                accept={ACCEPTED_FILES}
                required={!files.length}
                disabled={pending}
                onChange={(event) => {
                  chooseFiles(Array.from(event.target.files ?? []));
                  setError("");
                }}
              />
              {files.length > 0 && (
                <p role="status">
                  Selected: {files.map((f) => f.name).join(", ")}
                </p>
              )}
              {skipped.length > 0 && (
                <p className="kindred-skipped">
                  Skipped (not donor data): {skipped.join(", ")}
                </p>
              )}
              {error && <p role="alert">{error}</p>}
              <button
                className="kindred-upload"
                type="submit"
                disabled={!files.length || pending}
              >
                {pending
                  ? `Reading your files… ${elapsed}s (about a minute)`
                  : "Import donor data"}
              </button>
              <span role="status" className="sr-only">
                {pending ? "Import in progress. Please wait." : ""}
              </span>
            </form>
          )}
          {(result || !canUpload) && (
            <a className="kindred-workspace-link" href="#/">
              {result ? "View donor workspace" : "Explore sample workspace"}
            </a>
          )}
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
    result.duplicates != null
      ? `${result.duplicates} possible duplicates`
      : null,
  ].filter(Boolean);
  return parts.length
    ? parts.join(" · ")
    : (result.message ?? "Your files were imported.");
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
  const elapsed = useElapsed(pending);
  // Choosing the sample is choosing to skip setup: open the dashboard, not step 1 ("Drag in your files"),
  // with the quick-tour card offered there. "Set up again" in the user menu still runs setup. Only on the
  // sample build: a laptop build that fell back to the snapshot (API down) shares this setup state, and
  // must still run first-run setup once its service is back.
  const onboarding = useOnboarding();
  const openWorkspace = () => {
    if (SAMPLE_BUILD && !onboarding.data.completedAt) onboarding.finish();
  };

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
      setResult(
        await donorDeskMethods.uploadFiles(await loadSampleFiles(files)),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "We couldn’t import the sample files.",
      );
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
              ? "This sample workspace was built from the 8 example files in data/sample_inputs. It’s read-only here; run it on a laptop to upload your own files."
              : canUpload
                ? "The example files from data/sample_inputs/. Every name, email and amount is invented. You can also drag them onto the landing page yourself."
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
                    <span className="kindred-sample-size">
                      {formatBytes(file.bytes)}
                    </span>
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
              {pending ? `Reading your files… ${elapsed}s` : "Go"}
            </button>
            {pending && (
              <p role="status" className="kindred-sample-target">
                Reading {files?.length} files and sorting people into Givers,
                Neighbors and Community. This takes about a minute.
              </p>
            )}
          </>
        )}

        {done && (
          <a
            className="kindred-workspace-link"
            href="#/"
            onClick={openWorkspace}
          >
            Open the CRM
          </a>
        )}
        {error && canUpload && files && (
          <p className="kindred-sample-target">
            You can also drag the example files from{" "}
            <code>data/sample_inputs/</code> into the app yourself.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
};

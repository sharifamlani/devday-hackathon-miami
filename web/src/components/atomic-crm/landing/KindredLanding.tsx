import { UploadProcessing } from "../upload/UploadProcessing";
import { ingestSummary } from "../onboarding/firstRun";
import {
  useEffect,
  useRef,
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

/** Keep existing workspace deep links; the bare app URL opens the landing page. */
export const KindredLandingGate = ({ children }: { children: ReactNode }) => {
  const hash = useSyncExternalStore(subscribeToHash, getHash, () => "");
  // Live mode: the bare URL shows the landing only while the app has no people
  // and first-run setup is done or skipped; otherwise it goes straight to the
  // board (where onboarding opens when it is still to do). "#/welcome" always
  // shows the landing. The read-only snapshot build always has people, so it
  // keeps the landing as its front door.
  const hasPeople = useHasPeople();
  // One front door: while first-run setup is still to do, the empty app goes
  // straight into it (onboarding step 1 is where files are uploaded, once).
  // The landing is for an empty app whose setup was already finished or skipped.
  const { data: onboarding } = useOnboarding();
  const setupPending = DATA_MODE === "local" && !onboarding.completedAt;
  // useHasPeople reads /donors once, on mount: for an app that started empty it
  // stays false. When setup finishes in this page load its files have been
  // imported, so the board stays; the landing is never the next screen.
  const sawSetupPending = useRef(false);
  if (setupPending) sawSetupPending.current = true;
  const justFinishedSetup = sawSetupPending.current && !setupPending;
  if (hash === "#/welcome") return <KindredLanding />;
  if (hash !== "") return children;
  if (hasPeople === null) return null;
  return hasPeople || setupPending || justFinishedSetup ? (
    children
  ) : (
    <KindredLanding />
  );
};

/** null while the live service is being asked; always false in snapshot mode. */
const useHasPeople = (): boolean | null => {
  const [hasPeople, setHasPeople] = useState<boolean | null>(
    DATA_MODE === "local" ? null : false,
  );
  useEffect(() => {
    if (DATA_MODE !== "local") return;
    let live = true;
    donorDeskMethods
      .getDonors()
      .then((donors) => live && setHasPeople(donors.length > 0))
      .catch(() => live && setHasPeople(false));
    return () => {
      live = false;
    };
  }, []);
  return hasPeople;
};

/**
 * Files that aren't donor data: the answer key, READMEs and hidden files. The same rule as onboarding
 * (onboarding/firstRun.ts skipReason) minus its extension check, since the landing also takes .txt.
 * /ingest reads .json and .md, so without this the answer key and the README would be imported as data.
 */
const isNotDonorData = (name: string) =>
  /answer[_-]?key/i.test(name) ||
  /^_?readme\b/i.test(name) ||
  name.startsWith(".");

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

export const KindredLanding = ({
  onPreviewUpload,
  onSkip,
}: {
  /** Development-only click-through: no file is read or sent by this action. */
  onPreviewUpload?: () => void;
  /** Setup step 1 only: leave setup for later (the dashboard opens). */
  onSkip?: () => void;
} = {}) => {
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
  const onboarding = useOnboarding();
  const canUpload = DATA_MODE === "local";
  const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
    accept: ACCEPTED_TYPES,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    disabled: pending,
    onDrop: (accepted, rejected) => {
      if (onPreviewUpload) return onPreviewUpload();
      setResult(null);
      setError("");
      if (canUpload) {
        chooseFiles(accepted);
        // The answer key (.json) is refused by type too: list it as skipped, not as a wrong file
        const wrong = rejected.filter((r) => !isNotDonorData(r.file.name));
        const notData = rejected
          .filter((r) => isNotDonorData(r.file.name))
          .map((r) => r.file.name);
        if (notData.length) setSkipped((s) => [...s, ...notData]);
        if (wrong.length)
          setError("Please choose .csv, .xlsx, .docx, .md or .txt files.");
      }
      setUploadOpen(true);
    },
  });

  // Live "Try sample data": load the example files and import them like an upload, so the
  // folder animation and its results lead on to the organization step.
  const importSample = async () => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const sample = await loadSampleFiles(await loadSampleManifest());
      setFiles(sample);
      const done = await donorDeskMethods.uploadFiles(sample);
      // Saved now, so a reload or "Review matches" doesn't send setup back to step 1.
      onboarding.update({ files: ingestSummary(done, sample.length) });
      setResult(done);
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

  const importDonors = async () => {
    if (!canUpload || !files.length || pending) return;
    setPending(true);
    setError("");
    try {
      const done = await donorDeskMethods.uploadFiles(files);
      onboarding.update({ files: ingestSummary(done, files.length) });
      setResult(done);
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

  if (pending || result)
    return (
      <UploadProcessing
        pending={pending}
        summary={result ? ingestSummary(result, files.length) : null}
        onContinue={() => {
          if (!result) return;
          onboarding.update({ files: ingestSummary(result, files.length) });
          onboarding.start(1);
          window.location.hash = "#/";
        }}
        onReviewDuplicates={() => {
          onboarding.finishLater();
          window.location.hash = "#/contacts";
        }}
      />
    );

  return (
    <main
      className={`kindred-landing${areColorsPaused ? " colors-paused" : ""}`}
      aria-labelledby="kindred-heading"
    >
      <div className="kindred-landing-content">
        {DATA_MODE === "snapshot" && !onPreviewUpload && (
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
        <p className="kindred-wordmark">gatherly</p>
        <h1 id="kindred-heading" className="kindred-headline" tabIndex={-1}>
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
              if (onPreviewUpload) return onPreviewUpload();
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
          onClick={() =>
            onPreviewUpload
              ? onPreviewUpload()
              : canUpload
                ? void importSample()
                : setSampleOpen(true)
          }
        >
          Try sample data
        </button>
        {error && !isUploadOpen && (
          <p role="alert" className="kindred-file-hint">
            {error}
          </p>
        )}
        <ol className="kindred-steps" aria-label="How Gatherly works">
          <li>Upload your list</li>
          <li>Understand your donors</li>
          <li>Reach out thoughtfully</li>
        </ol>
        {onSkip && (
          <button type="button" className="kindred-skip" onClick={onSkip}>
            Skip for now
          </button>
        )}
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

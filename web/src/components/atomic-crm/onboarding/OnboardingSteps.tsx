import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  FileText,
  LoaderCircle,
  Upload,
  X as XIcon,
} from "lucide-react";
import { useDropzone } from "react-dropzone";

import { Input } from "@/components/ui/input";
import { formatBytes } from "../landing/sampleFiles";
import { DATA_MODE } from "../providers/local/config";
import type { UploadTarget } from "../providers/local/crmTypes";
import { sourceOf } from "../providers/local/endpoint";
import {
  useDonors,
  useOrgProfile,
  useRunContext,
  useUploadFiles,
} from "../providers/local/hooks";
import { useGenerateTasks } from "../providers/local/tasks";
import {
  ACCEPT_ATTRIBUTE,
  LAND_DELAY_MS,
  SAMPLE_FOLDER,
  addFiles,
  contextReducer,
  contextSummary,
  doneLine,
  filesLine,
  ingestSummary,
  plainError,
  sourceRows,
  tasksRow,
  type SkippedFile,
  type SourceRow,
} from "./firstRun";
import {
  SOCIAL_LABELS,
  SOCIAL_PLATFORMS,
  useOnboarding,
  validateLinks,
  type ContextSummary,
  type FilesSummary,
  type LinkErrors,
  type OrgLinks,
} from "./onboardingState";

/** The laptop build talks to the service; the Vercel snapshot has no API. */
const LIVE = DATA_MODE === "local";

/* ---------- Shared frame ---------- */

export interface StepFrameProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
}

const StepForm = ({
  title,
  lede,
  headingRef,
  onSubmit,
  onBack,
  showBack = true,
  actions,
  children,
}: StepFrameProps & {
  title: ReactNode;
  lede?: ReactNode;
  onSubmit: () => void;
  showBack?: boolean;
  actions: ReactNode;
  children?: ReactNode;
}) => {
  const titleId = useId();
  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      onSubmit();
    },
    [onSubmit],
  );
  return (
    <form
      className="grid gap-[22px]"
      onSubmit={submit}
      aria-labelledby={titleId}
      noValidate
    >
      <div>
        <h2
          id={titleId}
          ref={headingRef}
          tabIndex={-1}
          className="onb-headline"
        >
          {title}
        </h2>
        {lede && <p className="onb-lede">{lede}</p>}
      </div>
      {children}
      <div className="onb-actions">
        {showBack && (
          <button type="button" className="onb-btn quiet" onClick={onBack}>
            Back
          </button>
        )}
        <span className="onb-spacer" />
        {actions}
      </div>
    </form>
  );
};

const Field = ({
  id,
  label,
  hint,
  error,
  className,
  ...input
}: ComponentProps<"input"> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}) => {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`onb-field ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="border-muted-foreground/80 bg-card text-[15px]"
        {...input}
      />
      {hint && (
        <p id={hintId} className="onb-note">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="onb-error">
          {error}
        </p>
      )}
    </div>
  );
};

type Status = { tone: "good" | "error" | "info"; text: string } | null;

/* ---------- 1. Drag in your files ---------- */

const TARGETS: { value: UploadTarget; label: string }[] = [
  { value: "auto", label: "Let the agent sort" },
  { value: "giver", label: "Givers" },
  { value: "neighbor", label: "Neighbors" },
  { value: "community", label: "Community" },
];

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export const FilesStep = ({
  onContinue,
  ...frame
}: StepFrameProps & {
  onContinue: (files: FilesSummary | null) => void;
}) => {
  const { data } = useOnboarding();
  const { data: people } = useDonors();
  const upload = useUploadFiles();
  const [files, setFiles] = useState<File[]>([]);
  const [skipped, setSkipped] = useState<SkippedFile[]>([]);
  const [target, setTarget] = useState<UploadTarget>("auto");
  const [imported, setImported] = useState<FilesSummary | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const id = useId();
  const existing = people?.length ?? 0;
  const busy = upload.isPending;

  const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
    multiple: true,
    noClick: true,
    noKeyboard: true,
    disabled: !LIVE || busy,
    onDrop: (dropped) => {
      const next = addFiles(files, dropped);
      setFiles(next.files);
      setSkipped(next.skipped);
      setStatus(null);
    },
  });

  const remove = (name: string) =>
    setFiles((current) => current.filter((f) => f.name !== name));

  const submit = async () => {
    if (busy) return;
    if (!LIVE) return onContinue(data.files);
    if (!files.length) {
      if (imported || existing) return onContinue(imported ?? data.files);
      setStatus({
        tone: "error",
        text: "Drag in at least one file, or choose Skip for now.",
      });
      return;
    }
    setStatus(null);
    try {
      const result = await upload.mutateAsync({ files, target });
      const summary = ingestSummary(result, files.length);
      setImported(summary);
      setFiles([]);
      setSkipped([]);
      setStatus({ tone: "good", text: `${filesLine(summary)}.` });
    } catch (cause) {
      setStatus({
        tone: "error",
        text: plainError(cause, "We couldn't import these files. Try again."),
      });
    }
  };

  const primaryLabel = busy
    ? "Reading your files…"
    : files.length
      ? `Import ${plural(files.length, "file", "files")}`
      : "Continue";

  return (
    <StepForm
      {...frame}
      showBack={false}
      title={
        <>
          Drag in your <strong>files.</strong>
        </>
      }
      lede={
        LIVE ? (
          <>
            Donor exports, sign-in sheets, intake forms and notes. Trying it
            out? Drag in the example files from <code>{SAMPLE_FOLDER}</code>.
          </>
        ) : (
          "Donor exports, sign-in sheets, intake forms and notes become people and gifts."
        )
      }
      onSubmit={() => void submit()}
      actions={
        <>
          {LIVE && !imported && (
            <button
              type="button"
              className="onb-btn text"
              disabled={busy}
              onClick={() => onContinue(data.files)}
            >
              Skip for now
            </button>
          )}
          <button type="submit" className="onb-btn primary" disabled={busy}>
            {primaryLabel}
          </button>
        </>
      }
    >
      {LIVE ? (
        <>
          <div
            {...getRootProps({
              className: "onb-drop onb-tile",
              "data-active": isDragActive || undefined,
            })}
          >
            <input {...getInputProps({ accept: ACCEPT_ATTRIBUTE })} />
            <Upload aria-hidden="true" size={22} strokeWidth={1.7} />
            <p className="onb-drop-title">Drop your files here</p>
            <p className="onb-note">
              .xlsx · .docx · .md · .csv, up to 10 MB each
            </p>
            <button
              type="button"
              className="onb-btn quiet small"
              onClick={open}
              disabled={busy}
            >
              Choose files
            </button>
          </div>

          {files.length > 0 && (
            <ul className="onb-files" aria-label="Files to import">
              {files.map((file) => (
                <li key={file.name}>
                  <FileText aria-hidden="true" size={16} strokeWidth={1.7} />
                  <span className="onb-file-name">{file.name}</span>
                  <span className="onb-file-size">
                    {formatBytes(file.size)}
                  </span>
                  <button
                    type="button"
                    className="onb-icon-btn"
                    aria-label={`Remove ${file.name}`}
                    disabled={busy}
                    onClick={() => remove(file.name)}
                  >
                    <XIcon aria-hidden="true" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {skipped.length > 0 && (
            <ul className="onb-files skipped" aria-label="Files left out">
              {skipped.map((file) => (
                <li key={file.name}>
                  <CircleMinus aria-hidden="true" size={16} strokeWidth={1.7} />
                  <span className="onb-file-name">{file.name}</span>
                  <span className="onb-file-why">{file.reason}</span>
                </li>
              ))}
            </ul>
          )}

          <fieldset className="onb-radios" disabled={busy}>
            <legend>Put them in</legend>
            {TARGETS.map((option) => (
              <label key={option.value} htmlFor={`${id}-${option.value}`}>
                <input
                  type="radio"
                  id={`${id}-${option.value}`}
                  name={`${id}-target`}
                  value={option.value}
                  checked={target === option.value}
                  onChange={() => setTarget(option.value)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>

          <div aria-live="polite">
            {busy ? (
              <p className="onb-status">
                Reading your files and sorting people into tabs. This can take a
                minute.
              </p>
            ) : status ? (
              <p className="onb-status" data-tone={status.tone}>
                {status.text}
              </p>
            ) : !imported && existing > 0 && !files.length ? (
              <p className="onb-note">
                You already have {plural(existing, "person", "people")} in Donor
                Desk. Add more files or continue.
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <p className="onb-status" data-tone="good">
          Sample data · This preview already has the example files loaded
          {existing ? `: ${plural(existing, "person", "people")}` : ""}. Every
          name and amount is made up. Importing your own files needs the Donor
          Desk service.
        </p>
      )}
    </StepForm>
  );
};

/* ---------- 2. Tell us about your organization ---------- */

const LINK_FIELDS: {
  key: keyof OrgLinks;
  label: string;
  placeholder: string;
}[] = [
  {
    key: "website",
    label: "Website (required)",
    placeholder: "https://yourorg.org",
  },
  ...SOCIAL_PLATFORMS.map((platform) => ({
    key: platform,
    label: SOCIAL_LABELS[platform],
    placeholder: {
      x: "@yourorg",
      linkedin: "linkedin.com/company/yourorg",
      instagram: "@yourorg",
    }[platform],
  })),
];

export const OrganizationStep = ({
  onContinue,
  ...frame
}: StepFrameProps & { onContinue: (links: OrgLinks) => void }) => {
  const { data } = useOnboarding();
  const { data: profile } = useOrgProfile();
  const [links, setLinks] = useState<OrgLinks>(data.links);
  const [errors, setErrors] = useState<LinkErrors>({});
  const id = useId();

  // Prefill from the saved org profile once, without overwriting typing.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !profile) return;
    prefilled.current = true;
    const social = (platform: string) =>
      profile.socials.find((s) => s.platform === platform)?.url ?? "";
    setLinks((current) => ({
      website: current.website || profile.website || "",
      x: current.x || social("x"),
      linkedin: current.linkedin || social("linkedin"),
      instagram: current.instagram || social("instagram"),
    }));
  }, [profile]);

  const submit = () => {
    const result = validateLinks(links);
    setErrors(result.errors);
    const firstBad = LINK_FIELDS.find((f) => result.errors[f.key]);
    if (firstBad) {
      document.getElementById(`${id}-${firstBad.key}`)?.focus();
      return;
    }
    setLinks(result.links);
    onContinue(result.links);
  };

  const errorCount = Object.keys(errors).length;

  return (
    <StepForm
      {...frame}
      title={
        <>
          Tell us about your <strong>organization.</strong>
        </>
      }
      lede="The agent reads your website and recent news for stories, events and facts to use in outreach. It never posts for you."
      onSubmit={submit}
      actions={
        <button type="submit" className="onb-btn primary">
          Continue
        </button>
      }
    >
      <div className="onb-fields two">
        {LINK_FIELDS.map((field) => {
          const website = field.key === "website";
          return (
            <Field
              key={field.key}
              id={`${id}-${field.key}`}
              className={website ? "wide" : undefined}
              label={field.label}
              type={website ? "url" : "text"}
              inputMode="url"
              autoComplete={website ? "url" : "off"}
              spellCheck={false}
              required={website}
              aria-required={website || undefined}
              placeholder={field.placeholder}
              hint={
                website
                  ? "Social links are optional: paste a link or an @handle."
                  : undefined
              }
              value={links[field.key]}
              error={errors[field.key]}
              onChange={(e) => {
                const value = e.target.value;
                setLinks((current) => ({ ...current, [field.key]: value }));
                if (errors[field.key])
                  setErrors(({ [field.key]: _cleared, ...rest }) => rest);
              }}
            />
          );
        })}
      </div>
      <p className="sr-only" role="status">
        {errorCount
          ? `${errorCount} ${errorCount === 1 ? "field needs" : "fields need"} a fix.`
          : ""}
      </p>
      <p className="onb-note">
        {LIVE
          ? "Your links are saved to Donor Desk when the agent runs. X, LinkedIn and Instagram are saved for later; the agent doesn't read them yet."
          : "This preview keeps your links in this browser only."}
      </p>
    </StepForm>
  );
};

/* ---------- 3. The context agent runs on its own ---------- */

const ROW_ICON: Record<SourceRow["tone"], ReactNode> = {
  working: <LoaderCircle aria-hidden="true" size={16} className="onb-spin" />,
  done: <CircleCheck aria-hidden="true" size={16} />,
  problem: <CircleAlert aria-hidden="true" size={16} />,
  quiet: <CircleMinus aria-hidden="true" size={16} />,
};

const SourceList = ({ rows }: { rows: SourceRow[] }) => (
  <ul className="onb-sources" aria-label="What the agent is reading">
    {rows.map((row) => (
      <li key={row.key} data-tone={row.tone}>
        {ROW_ICON[row.tone]}
        <span className="onb-source-label">{row.label}</span>
        <span className="onb-source-text">{row.text}</span>
      </li>
    ))}
  </ul>
);

export const ContextStep = ({
  links,
  onDone,
  ...frame
}: StepFrameProps & {
  links: OrgLinks;
  /** Lands on the dashboard: after the run, on its own or from a button. */
  onDone: (summary: ContextSummary, savedLive: boolean) => void;
}) => {
  const runContext = useRunContext();
  const generateTasks = useGenerateTasks();
  const [phase, send] = useReducer(contextReducer, { phase: "reading" });
  const [attempt, setAttempt] = useState(0);
  const runStarted = useRef(-1);
  const tasksStarted = useRef<unknown>(null);

  // Starts on its own: no button press (plan.md §20.13).
  useEffect(() => {
    if (phase.phase !== "reading" || runStarted.current === attempt) return;
    runStarted.current = attempt;
    runContext
      .mutateAsync({
        website: links.website,
        x_url: links.x || null,
        linkedin_url: links.linkedin || null,
        instagram_url: links.instagram || null,
      })
      .then(
        (run) => send({ type: "run_ok", run }),
        (cause: unknown) =>
          send({
            type: "run_failed",
            message: plainError(cause, "We couldn't read your website."),
          }),
      );
  }, [phase.phase, attempt, links, runContext]);

  // Then today's tasks, if the service has the generator (3a); skipped otherwise.
  useEffect(() => {
    if (phase.phase !== "tasks" || tasksStarted.current === phase.run) return;
    tasksStarted.current = phase.run;
    void (async () => {
      const where = await sourceOf("POST", "/tasks/generate");
      if (where === "snapshot")
        return send({
          type: "tasks",
          result: { state: "skipped", reason: "Not in this preview" },
        });
      if (where === "unavailable")
        return send({
          type: "tasks",
          result: { state: "skipped", reason: "Not available yet" },
        });
      try {
        const made = await generateTasks.mutateAsync();
        send({
          type: "tasks",
          result: { state: "made", created: made?.created ?? 0 },
        });
      } catch {
        send({
          type: "tasks",
          result: { state: "failed", reason: "Couldn't make the list" },
        });
      }
    })();
  }, [phase, generateTasks]);

  const summary = contextSummary(phase);
  const savedLive =
    LIVE &&
    (phase.phase === "done" || phase.phase === "tasks") &&
    phase.run.served_from !== "fallback";

  // Done: land on the dashboard after a moment, so the result can be read.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  useEffect(() => {
    if (phase.phase !== "done" || !summary) return;
    const timer = window.setTimeout(
      () => onDoneRef.current(summary, savedLive),
      LAND_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
    // summary is derived from phase; re-arming on it would restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.phase]);

  const run = phase.phase === "reading" ? null : phase.run;
  const rows = sourceRows(links, run, phase.phase === "error");
  const taskRow = tasksRow(phase);
  if (taskRow) rows.push(taskRow);

  const announcement =
    phase.phase === "reading"
      ? "Reading your website and recent news."
      : phase.phase === "tasks"
        ? `Found ${run?.facts.length ?? 0} items. Making today's tasks.`
        : phase.phase === "done" && summary
          ? `${doneLine(summary)}. Opening your dashboard.`
          : phase.phase === "error"
            ? phase.message
            : "";

  const retry = () => {
    send({ type: "retry" });
    setAttempt((n) => n + 1);
  };

  const finishNow = () => {
    if (summary) onDone(summary, savedLive);
  };

  return (
    <StepForm
      {...frame}
      title={
        <>
          Building your <strong>context.</strong>
        </>
      }
      lede={
        phase.phase === "error"
          ? "The agent couldn't finish. You can still use Donor Desk and run it again later."
          : "The agent is reading your website and recent news. This can take up to 30 seconds."
      }
      onSubmit={finishNow}
      actions={
        phase.phase === "error" ? (
          <>
            <button type="button" className="onb-btn quiet" onClick={retry}>
              Try again
            </button>
            <button type="submit" className="onb-btn primary">
              Continue to the dashboard
            </button>
          </>
        ) : phase.phase === "done" ? (
          <button type="submit" className="onb-btn primary">
            Go to the dashboard
          </button>
        ) : null
      }
    >
      <SourceList rows={rows} />
      {phase.phase === "done" && summary && (
        <p className="onb-status" data-tone="good">
          {doneLine(summary)}.{" "}
          {summary.outcome === "saved"
            ? "The live read failed, so this is your saved context. "
            : ""}
          Opening your dashboard…
        </p>
      )}
      {phase.phase === "error" && (
        <p className="onb-status" data-tone="error">
          {phase.message}
        </p>
      )}
      {!LIVE && (
        <p className="onb-note">
          Sample data · This preview shows saved sample context. It can't read
          websites live.
        </p>
      )}
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </StepForm>
  );
};

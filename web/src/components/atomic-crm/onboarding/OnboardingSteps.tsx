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
  ChevronDown,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  FileText,
  LoaderCircle,
  Upload,
  X as XIcon,
} from "lucide-react";
import { useDropzone } from "react-dropzone";

import {
  formatBytes,
  loadSampleFiles,
  loadSampleManifest,
} from "../landing/sampleFiles";
import { DATA_MODE } from "../providers/local/config";
import type { UploadTarget } from "../providers/local/crmTypes";
import type { DonorSummary } from "../providers/local/types";
import { sourceOf } from "../providers/local/endpoint";
import {
  useDonors,
  useOrgProfile,
  useRunContext,
  useUploadFiles,
} from "../providers/local/hooks";
import { useGenerateTasks } from "../providers/local/tasks";
import { startBackgroundRead } from "./backgroundRead";
import {
  ACCEPT_ATTRIBUTE,
  COLLAPSE_AFTER,
  WELCOME_MS,
  addFiles,
  checklist,
  clock,
  contextReducer,
  contextSummary,
  filesStepAction,
  ingestSummary,
  plainError,
  progressFraction,
  receiptLine,
  tabRows,
  totalBytes,
  type Receipt,
  type SkippedFile,
  type SourceRow,
} from "./firstRun";
import {
  FIELD_PREFIX,
  SOCIAL_LABELS,
  SOCIAL_PLATFORMS,
  checkField,
  fieldsFromLinks,
  linksFromFields,
  onboardingStore,
  socialFieldValue,
  useOnboarding,
  validateLinks,
  websiteFieldChange,
  websiteInputText,
  websitePrefix,
  type ContextSummary,
  type FilesSummary,
  type LinkErrors,
  type OrgLinks,
  type SocialPlatform,
} from "./onboardingState";

/** The laptop build talks to the service; the Vercel snapshot has no API. */
const LIVE = DATA_MODE === "local";

/** Measured on the 8 example files against the local service: about a minute. */
const INGEST_TIME = "This usually takes about a minute.";

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/* ---------- Shared frame ---------- */

export interface StepFrameProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** Disables Back, Finish later and Esc while a request is in flight. */
  onBusy: (busy: boolean) => void;
}

/** Milliseconds since `active` turned on, ticking each second; 0 when off. */
const useElapsed = (active: boolean) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => setElapsed(Date.now() - start), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return active ? elapsed : 0;
};

/** Tells the frame while this step is busy, and clears it on the way out. */
const useReportBusy = (busy: boolean, onBusy: (busy: boolean) => void) => {
  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);
};

/**
 * One step: the heading and fields scroll, the footer stays put, so the main
 * button is always in the same place and never below the fold.
 */
const StepForm = ({
  title,
  lede,
  headingRef,
  onSubmit,
  secondary,
  primary,
  children,
}: Pick<StepFrameProps, "headingRef"> & {
  title: ReactNode;
  lede?: ReactNode;
  onSubmit: () => void;
  secondary?: ReactNode;
  primary: ReactNode;
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
      className="onb-step"
      onSubmit={submit}
      aria-labelledby={titleId}
      noValidate
    >
      <div className="onb-body">
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
      </div>
      <div className="onb-footer">
        {secondary}
        <span className="onb-spacer" />
        {primary}
      </div>
    </form>
  );
};

/** The main button; while saving it greys out with a spinner (Luma). */
const Primary = ({
  busy,
  children,
  ...button
}: ComponentProps<"button"> & { busy?: boolean }) => (
  <button
    type="submit"
    className="onb-btn primary"
    {...button}
    disabled={busy || button.disabled}
  >
    {busy && <LoaderCircle aria-hidden="true" size={16} className="onb-spin" />}
    {children}
  </button>
);

type Status = { tone: "good" | "error" | "info"; text: string } | null;

/* ---------- 1. Drag in your files ---------- */

const TARGETS: { value: UploadTarget; label: string }[] = [
  { value: "auto", label: "Let the agent sort" },
  { value: "giver", label: "Givers" },
  { value: "neighbor", label: "Neighbors" },
  { value: "community", label: "Community" },
];

/** folk's "Import finished": what came in, per tab, and what to check. */
export const ImportReceipt = ({
  summary,
  fresh,
  people,
  onReviewDuplicates,
  onAddMore,
}: {
  summary: FilesSummary;
  fresh: boolean;
  people: DonorSummary[];
  onReviewDuplicates: () => void;
  onAddMore: () => void;
}) => {
  const tabs = tabRows(summary);
  const headingId = useId();
  const totals = [
    summary.people != null ? plural(summary.people, "person", "people") : null,
    summary.gifts != null
      ? plural(summary.gifts, "gift", "gifts") +
        // A declined charge is kept on record but isn't a gift (matches demo_reset's wording).
        (summary.declined
          ? ` (+${plural(summary.declined, "declined charge", "declined charges")} on record)`
          : "")
      : null,
  ].filter(Boolean);
  return (
    <section className="onb-receipt onb-tile" aria-labelledby={headingId}>
      <div className="onb-receipt-head">
        <CircleCheck aria-hidden="true" size={20} />
        <div>
          <h3 id={headingId}>
            {fresh ? "Import finished" : "Already imported"}
          </h3>
          <p>
            {totals.length ? totals.join(" · ") : "Your files are in"} from{" "}
            {plural(summary.files, "file", "files")}
          </p>
        </div>
      </div>
      {tabs && (
        <ul className="onb-tab-counts" aria-label="People by tab">
          {tabs.map((row) => (
            <li key={row.tab}>
              <span className="onb-tab-count">
                {row.count.toLocaleString("en-US")}
              </span>
              <span>{row.label}</span>
            </li>
          ))}
        </ul>
      )}
      {(summary.duplicates ?? 0) > 0 && (
        <p className="onb-receipt-line">
          <span>
            {plural(
              summary.duplicates ?? 0,
              "possible duplicate",
              "possible duplicates",
            )}{" "}
            to review.
          </span>
          <button
            type="button"
            className="onb-btn text small"
            onClick={onReviewDuplicates}
          >
            Review duplicates
          </button>
        </p>
      )}
      {(summary.review ?? 0) > 0 && (
        <p className="onb-receipt-line">
          {plural(summary.review ?? 0, "person", "people")} to double-check: the
          agent wasn't sure which tab they belong in.
        </p>
      )}
      {people.length > 0 && (
        <details className="onb-structured-preview">
          <summary>Preview structured records ({people.length})</summary>
          <div className="onb-structured-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Tab</th>
                  <th scope="col">Gifts</th>
                  <th scope="col">Last gift</th>
                  <th scope="col">Total given</th>
                </tr>
              </thead>
              <tbody>
                {people.slice(0, 12).map((person) => (
                  <tr key={person.id}>
                    <th scope="row">{person.full_name}</th>
                    <td>{person.contact_type ?? "Unclassified"}</td>
                    <td>{person.gift_count}</td>
                    <td>
                      {person.last_gift_date
                        ? new Date(`${person.last_gift_date}T00:00:00Z`).toLocaleDateString(
                            "en-US",
                            { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
                          )
                        : "—"}
                    </td>
                    <td>
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: "USD",
                        maximumFractionDigits: 0,
                      }).format(person.total_given)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {people.length > 12 && (
              <p>Showing 12 of {people.length} records. All are available in the workspace.</p>
            )}
          </div>
        </details>
      )}
      <p className="onb-receipt-line">
        <button
          type="button"
          className="onb-btn text small"
          onClick={onAddMore}
        >
          Add more files
        </button>
      </p>
    </section>
  );
};

export const FilesStep = ({
  onContinue,
  onReviewDuplicates,
  onBusy,
  ...frame
}: StepFrameProps & {
  onContinue: (files: FilesSummary | null) => void;
  onReviewDuplicates: () => void;
}) => {
  const { data, update } = useOnboarding();
  const { data: people, refetch: refetchPeople } = useDonors();
  const upload = useUploadFiles();
  const [files, setFiles] = useState<File[]>([]);
  const [skipped, setSkipped] = useState<SkippedFile[]>([]);
  const [target, setTarget] = useState<UploadTarget>("auto");
  const [status, setStatus] = useState<Status>(null);
  const [listOpen, setListOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const id = useId();
  const listId = `${id}-list`;
  const existing = people?.length ?? 0;
  const uploading = upload.isPending;
  const busy = uploading || loadingSample;
  const elapsed = useElapsed(uploading);
  useReportBusy(busy, onBusy);
  // Saved in onboarding state right after ingest succeeds, so leaving or
  // reloading before Continue never asks for the same files again.
  const imported = data.files;
  const showReceipt = LIVE && !!imported && !adding && files.length === 0;

  const choose = (incoming: File[]) => {
    const next = addFiles(files, incoming);
    setFiles(next.files);
    setSkipped(next.skipped);
    setStatus(null);
  };

  const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
    multiple: true,
    noClick: true,
    noKeyboard: true,
    disabled: !LIVE || busy,
    onDrop: choose,
  });

  const remove = (name: string) =>
    setFiles((current) => current.filter((f) => f.name !== name));

  const importExamples = async () => {
    setLoadingSample(true);
    setStatus(null);
    try {
      const examples = await loadSampleFiles(await loadSampleManifest());
      setFiles(examples);
      const result = await upload.mutateAsync({ files: examples, target: "auto" });
      update({ files: ingestSummary(result, examples.length) });
      await refetchPeople();
      setFiles([]);
      setSkipped([]);
      setListOpen(false);
      setAdding(false);
      setFresh(true);
    } catch (cause) {
      setStatus({
        tone: "error",
        text: plainError(cause, "The demo files couldn't be imported."),
      });
    } finally {
      setLoadingSample(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    if (!LIVE) return onContinue(data.files);
    const action = filesStepAction({
      pending: files.length,
      imported,
      existing,
    });
    if (action === "continue") return onContinue(imported);
    if (action === "need_files") {
      setStatus({
        tone: "error",
        text: "Add at least one file, or choose Skip for now.",
      });
      return;
    }
    setStatus(null);
    try {
      const result = await upload.mutateAsync({ files, target });
      update({ files: ingestSummary(result, files.length) });
      await refetchPeople();
      setFiles([]);
      setSkipped([]);
      setListOpen(false);
      setAdding(false);
      setFresh(true);
    } catch (cause) {
      setStatus({
        tone: "error",
        text: plainError(cause, "We couldn't import these files. Try again."),
      });
    }
  };

  const collapsible = files.length > COLLAPSE_AFTER;
  const showList = !collapsible || listOpen;

  return (
    <StepForm
      {...frame}
      title={
        <>
          Drag in your <strong>files.</strong>
        </>
      }
      lede={
        LIVE
          ? "Donor exports, sign-in sheets, intake forms and notes become people and gifts, sorted into Givers, Neighbors and Community."
          : "Donor exports, sign-in sheets, intake forms and notes become people and gifts."
      }
      onSubmit={() => void submit()}
      secondary={
        LIVE && !imported ? (
          <button
            type="button"
            className="onb-btn text"
            disabled={busy}
            onClick={() => onContinue(null)}
          >
            Skip for now
          </button>
        ) : null
      }
      primary={
        <Primary busy={busy}>
          {busy
            ? "Importing…"
            : files.length
              ? `Import ${plural(files.length, "file", "files")}`
              : "Continue"}
        </Primary>
      }
    >
      {!LIVE ? (
        <p className="onb-status" data-tone="good">
          Sample data · This preview already has the example files loaded
          {existing ? `: ${plural(existing, "person", "people")}` : ""}. Every
          name and amount is made up. Importing your own files needs the Donor
          Desk service.
        </p>
      ) : showReceipt && imported ? (
        <ImportReceipt
          summary={imported}
          fresh={fresh}
          people={people ?? []}
          onReviewDuplicates={onReviewDuplicates}
          onAddMore={() => {
            setAdding(true);
            setFresh(false);
          }}
        />
      ) : (
        <>
          <div
            {...getRootProps({
              className: "onb-drop onb-tile",
              "data-active": isDragActive || undefined,
              "aria-disabled": busy || undefined,
            })}
          >
            <input {...getInputProps({ accept: ACCEPT_ATTRIBUTE })} />
            <Upload aria-hidden="true" size={22} strokeWidth={1.7} />
            <p className="onb-drop-title">Drop your files here</p>
            <p className="onb-note">
              .xlsx · .docx · .md · .csv, up to 10 MB each
            </p>
            <div className="onb-drop-actions">
              <button
                type="button"
                className="onb-btn quiet small"
                onClick={open}
                disabled={busy}
              >
                Choose files
              </button>
              <button
                type="button"
                className="onb-btn text small"
                onClick={() => void importExamples()}
                disabled={busy || (!!imported && !adding)}
              >
                {loadingSample ? "Importing demo files…" : "Import demo files"}
              </button>
            </div>
          </div>

          {files.length > 0 && (
            <div className="onb-chosen">
              <div className="onb-chosen-head">
                <FileText aria-hidden="true" size={16} strokeWidth={1.7} />
                <span>
                  {plural(files.length, "file", "files")} ready ·{" "}
                  {formatBytes(totalBytes(files))}
                </span>
                {collapsible && (
                  <button
                    type="button"
                    className="onb-btn text small"
                    aria-expanded={listOpen}
                    aria-controls={listId}
                    onClick={() => setListOpen((v) => !v)}
                  >
                    {listOpen ? "Hide list" : "Show list"}
                    <ChevronDown
                      aria-hidden="true"
                      size={14}
                      className="onb-chevron"
                      data-open={listOpen || undefined}
                    />
                  </button>
                )}
              </div>
              <ul
                id={listId}
                hidden={!showList}
                className="onb-files"
                aria-label="Files to import"
              >
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
            </div>
          )}

          {skipped.length > 0 && (
            <ul className="onb-files skipped" aria-label="Files left out">
              {skipped.map((file, i) => (
                <li key={`${i}-${file.name}`}>
                  <CircleMinus aria-hidden="true" size={16} strokeWidth={1.7} />
                  <span className="onb-file-name">{file.name}</span>
                  <span className="onb-file-why">{file.reason}</span>
                </li>
              ))}
            </ul>
          )}

          {files.length > 0 && (
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
          )}

          {!files.length && existing > 0 && (
            <p className="onb-note">
              You already have {plural(existing, "person", "people")} in Donor
              Desk. Add more files or continue.
            </p>
          )}
        </>
      )}

      <div aria-live="polite">
        {uploading ? (
          <p className="onb-status">
            Reading your files and sorting people into tabs · {clock(elapsed)}.{" "}
            {INGEST_TIME}
          </p>
        ) : status ? (
          <p className="onb-status" data-tone={status.tone}>
            {status.text}
          </p>
        ) : null}
      </div>
    </StepForm>
  );
};

/* ---------- 2. Tell us about your organization ---------- */

const SOCIAL_PLACEHOLDER: Record<SocialPlatform, string> = {
  x: "yourorg",
  linkedin: "company/yourorg",
  instagram: "yourorg",
};

/** A text field with a grey prefix inside its box ("https://", "x.com/"). */
const PrefixField = ({
  id,
  label,
  prefix,
  hint,
  error,
  className,
  ...input
}: ComponentProps<"input"> & {
  id: string;
  label: string;
  prefix: string;
  hint?: ReactNode;
  error?: string;
}) => {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const prefixId = `${id}-prefix`;
  const describedBy =
    [prefixId, hint && hintId, error && errorId].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div className={`onb-field ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      <div className="onb-prefixed" data-invalid={error ? true : undefined}>
        <span id={prefixId} className="onb-prefix">
          {prefix}
        </span>
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...input}
        />
      </div>
      {error && (
        <p id={errorId} className="onb-error">
          <CircleAlert aria-hidden="true" size={14} />
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="onb-note">
          {hint}
        </p>
      )}
    </div>
  );
};

export const OrganizationStep = ({
  onContinue,
  onBusy: _onBusy,
  ...frame
}: StepFrameProps & { onContinue: (links: OrgLinks) => void }) => {
  const { data } = useOnboarding();
  const { data: profile } = useOrgProfile();
  const [fields, setFields] = useState<OrgLinks>(() =>
    fieldsFromLinks(data.links),
  );
  const [errors, setErrors] = useState<LinkErrors>({});
  const id = useId();

  // Prefill from the saved org profile once, without overwriting typing.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !profile) return;
    prefilled.current = true;
    const social = (platform: string) =>
      profile.socials.find((s) => s.platform === platform)?.url ?? "";
    const saved = fieldsFromLinks({
      website: profile.website ?? "",
      x: social("x"),
      linkedin: social("linkedin"),
      instagram: social("instagram"),
    });
    setFields((current) => ({
      website: current.website || saved.website,
      x: current.x || saved.x,
      linkedin: current.linkedin || saved.linkedin,
      instagram: current.instagram || saved.instagram,
    }));
  }, [profile]);

  const set = (key: keyof OrgLinks, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _cleared, ...rest }) => rest);
  };

  // Inline check when leaving a field; an empty website waits for Continue.
  const blur = (key: keyof OrgLinks) => {
    const value =
      key === "website" ? fields.website : socialFieldValue(key, fields[key]);
    if (value !== fields[key]) set(key, value);
    const error = checkField(key, value);
    setErrors(({ [key]: _old, ...rest }) =>
      error ? { ...rest, [key]: error } : rest,
    );
  };

  const submit = () => {
    const result = validateLinks(linksFromFields(fields));
    setErrors(result.errors);
    const order: (keyof OrgLinks)[] = ["website", ...SOCIAL_PLATFORMS];
    const firstBad = order.find((key) => result.errors[key]);
    if (firstBad) {
      document.getElementById(`${id}-${firstBad}`)?.focus();
      return;
    }
    setFields(fieldsFromLinks(result.links));
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
      primary={<Primary>Continue</Primary>}
    >
      <PrefixField
        id={`${id}-website`}
        data-autofocus=""
        label="Website"
        prefix={websitePrefix(fields.website)}
        type="text"
        inputMode="url"
        autoComplete="url"
        autoCapitalize="none"
        spellCheck={false}
        required
        aria-required
        placeholder="yourorg.org"
        value={websiteInputText(fields.website)}
        error={errors.website}
        onChange={(e) =>
          set("website", websiteFieldChange(fields.website, e.target.value))
        }
        onBlur={() => blur("website")}
        hint={
          LIVE
            ? "Next, the agent reads your site and recent news. That takes about half a minute; if it runs longer, it keeps reading in the background while you start."
            : "This preview shows saved sample context instead of reading your site."
        }
      />

      <fieldset className="onb-socials">
        <legend>
          Social links <span className="onb-optional">(optional)</span>
        </legend>
        <p className="onb-note">
          Saved for later; the agent doesn't read them yet. Paste a link or type
          your handle.
        </p>
        <div className="onb-fields">
          {SOCIAL_PLATFORMS.map((platform) => (
            <PrefixField
              key={platform}
              id={`${id}-${platform}`}
              label={SOCIAL_LABELS[platform]}
              prefix={FIELD_PREFIX[platform]}
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={SOCIAL_PLACEHOLDER[platform]}
              value={fields[platform]}
              error={errors[platform]}
              onChange={(e) => set(platform, e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (!pasted) return;
                e.preventDefault();
                set(platform, socialFieldValue(platform, pasted));
              }}
              onBlur={() => blur(platform)}
            />
          ))}
        </div>
      </fieldset>
      <p className="sr-only" role="status">
        {errorCount
          ? `${errorCount} ${errorCount === 1 ? "field needs" : "fields need"} a fix.`
          : ""}
      </p>
      {!LIVE && (
        <p className="onb-note">
          This preview keeps your links in this browser only.
        </p>
      )}
    </StepForm>
  );
};

/* ---------- 3. The context agent runs on its own ---------- */

const ROW_ICON: Record<SourceRow["tone"], ReactNode> = {
  active: <LoaderCircle aria-hidden="true" size={16} className="onb-spin" />,
  done: <CircleCheck aria-hidden="true" size={16} />,
  pending: <Circle aria-hidden="true" size={16} />,
  problem: <CircleAlert aria-hidden="true" size={16} />,
  quiet: <CircleMinus aria-hidden="true" size={16} />,
};

const TONE_WORD: Record<SourceRow["tone"], string> = {
  active: "In progress",
  done: "Done",
  pending: "Not started",
  problem: "Problem",
  quiet: "Skipped",
};

const Checklist = ({ rows }: { rows: SourceRow[] }) => (
  <ul className="onb-sources" aria-label="What the agent is doing">
    {rows.map((row) => (
      <li key={row.key} data-tone={row.tone}>
        {ROW_ICON[row.tone]}
        <span className="sr-only">{TONE_WORD[row.tone]}:</span>
        <span className="onb-source-label">{row.label}</span>
        <span className="onb-source-text">{row.text}</span>
      </li>
    ))}
  </ul>
);

const ProgressBar = ({ value, label }: { value: number; label: string }) => {
  const percent = Math.round(value * 100);
  return (
    <div className="onb-bar-wrap">
      <div
        className="onb-bar"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${label}, ${percent} percent`}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="onb-bar-label" aria-hidden="true">
        {label}
      </p>
    </div>
  );
};

/** "The Miami Foundation" → "MF" (skips "the", "of"...). */
const initials = (name: string | null) =>
  (name ?? "")
    .split(/\s+/)
    .filter((w) => w && !/^(the|of|and|for|a|an)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export const ContextReceipt = ({ receipt }: { receipt: Receipt }) => (
  <section className="onb-receipt onb-tile" aria-label="What the agent found">
    <div className="onb-receipt-head">
      <CircleCheck aria-hidden="true" size={20} />
      <div>
        <h3>{LIVE ? "Read your website" : "Sample context loaded"}</h3>
        <p>{receiptLine(receipt)}</p>
      </div>
    </div>
    {receipt.titles.length > 0 && (
      <ul className="onb-fact-list" aria-label="A few of the facts">
        {receipt.titles.map((title, i) => (
          // Facts can repeat (the same line from two pages), so the text alone isn't a unique key.
          <li key={`${i}-${title}`}>{title}</li>
        ))}
      </ul>
    )}
  </section>
);

export const ContextStep = ({
  links,
  onDone,
  onBusy,
  ...frame
}: StepFrameProps & {
  links: OrgLinks;
  /** Lands on the dashboard: after the run, on its own or from a button. */
  onDone: (summary: ContextSummary, savedLive: boolean) => void;
}) => {
  const { data, update } = useOnboarding();
  const runContext = useRunContext();
  const generateTasks = useGenerateTasks();
  const [phase, send] = useReducer(contextReducer, { phase: "reading" });
  const [attempt, setAttempt] = useState(0);
  const runStarted = useRef(-1);
  const tasksStarted = useRef<unknown>(null);
  const backgroundStartedFor = useRef<unknown>(null);
  const reading = phase.phase === "reading";
  const busy = reading || phase.phase === "tasks";
  const elapsed = useElapsed(reading);
  useReportBusy(busy, onBusy);
  const website = links.website;

  // Starts on its own: no button press (plan.md §20.13).
  useEffect(() => {
    if (!reading || runStarted.current === attempt) return;
    runStarted.current = attempt;
    // A new run replaces an earlier background read and its status line.
    if (onboardingStore.get().data.background) update({ background: null });
    runContext
      .mutateAsync({
        website,
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
  }, [reading, attempt, website, links, runContext, update]);

  // Then today's tasks, if the service has the generator; skipped otherwise.
  useEffect(() => {
    if (phase.phase !== "tasks" || tasksStarted.current === phase.run) return;
    tasksStarted.current = phase.run;
    void (async () => {
      const where = await sourceOf("POST", "/tasks/generate");
      if (where === "snapshot" || where === "unavailable")
        return send({
          type: "tasks",
          result: {
            state: "skipped",
            reason:
              where === "snapshot"
                ? "Not in this preview"
                : "Not available yet",
          },
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

  // Slow: the service saved the links; keep reading in the background.
  useEffect(() => {
    if (phase.phase !== "slow" || backgroundStartedFor.current === phase.run)
      return;
    backgroundStartedFor.current = phase.run;
    startBackgroundRead().catch((cause: unknown) =>
      send({
        type: "background_failed",
        message: plainError(
          cause,
          "We couldn't keep reading your website in the background.",
        ),
      }),
    );
  }, [phase]);

  // Still here when the background read ends: show it like a finished run.
  const background = data.background;
  useEffect(() => {
    if (phase.phase !== "slow" || !backgroundStartedFor.current || !background)
      return;
    if (background.status === "done")
      send({ type: "background_done", read: background });
    else if (background.status === "failed")
      send({
        type: "background_failed",
        message: background.detail ?? "We couldn't read your website.",
      });
  }, [phase.phase, background]);

  const summary = contextSummary(phase);
  const savedLive =
    LIVE &&
    (phase.phase === "receipt" ||
      phase.phase === "welcome" ||
      phase.phase === "slow");

  // Receipt until the presenter clicks "Go to the dashboard" (the demo narrates it), then a short welcome,
  // then the dashboard. Nothing advances on its own while the receipt is up.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  useEffect(() => {
    if (phase.phase === "welcome") {
      const done = contextSummary(phase);
      const timer = window.setTimeout(() => {
        if (done) onDoneRef.current(done, LIVE);
      }, WELCOME_MS);
      return () => window.clearTimeout(timer);
    }
  }, [phase]);

  const rows = checklist(links, phase);
  const fraction = progressFraction(phase, elapsed);
  const barLabel =
    phase.phase === "reading"
      ? `Reading your website · ${clock(elapsed)}`
      : phase.phase === "tasks"
        ? "Making today's tasks"
        : phase.phase === "slow"
          ? "Reading in the background"
          : "Done";

  const announcement =
    phase.phase === "reading"
      ? "Reading your website and recent news."
      : phase.phase === "tasks"
        ? "Website read. Making today's tasks."
        : phase.phase === "receipt"
          ? `${receiptLine(phase.receipt)}. Go to the dashboard when you're ready.`
          : phase.phase === "welcome"
            ? "Welcome to Donor Desk."
            : phase.phase === "slow"
              ? "Reading your website is taking longer than usual. It goes on in the background; you can continue to the dashboard."
              : phase.message;

  const retry = () => {
    send({ type: "retry" });
    setAttempt((n) => n + 1);
  };

  const finishNow = () => {
    // From the receipt, the click shows the welcome card first; it opens the dashboard after WELCOME_MS
    if (phase.phase === "receipt") return send({ type: "welcome" });
    if (summary) onDone(summary, savedLive);
  };

  const title =
    phase.phase === "welcome" ? (
      <>
        Welcome to <strong>Donor Desk.</strong>
      </>
    ) : phase.phase === "receipt" ? (
      <>
        Your desk is <strong>set up.</strong>
      </>
    ) : phase.phase === "slow" ? (
      <>
        Still reading <strong>your site.</strong>
      </>
    ) : phase.phase === "error" ? (
      <>
        We couldn't read <strong>your site.</strong>
      </>
    ) : (
      <>
        Building your <strong>context.</strong>
      </>
    );

  const lede =
    phase.phase === "welcome"
      ? (phase.receipt.orgName ?? "Opening your dashboard.")
      : phase.phase === "error"
        ? "You can still use Donor Desk and run it again later."
        : phase.phase === "slow"
          ? "Reading your website is taking longer than usual. We'll keep reading in the background, and new facts appear on your dashboard when it's done."
          : phase.phase === "receipt"
            ? undefined
            : "The agent is reading your website and recent news. This takes about half a minute; if it runs longer, it keeps going in the background.";

  return (
    <StepForm
      {...frame}
      title={title}
      lede={lede}
      onSubmit={finishNow}
      secondary={
        phase.phase === "error" ? (
          <button type="button" className="onb-btn quiet" onClick={retry}>
            Try again
          </button>
        ) : null
      }
      primary={
        busy ? (
          <Primary busy>
            {phase.phase === "tasks" ? "Making tasks…" : "Reading…"}
          </Primary>
        ) : (
          <Primary>
            {phase.phase === "error" || phase.phase === "slow"
              ? "Continue to the dashboard"
              : "Go to the dashboard"}
          </Primary>
        )
      }
    >
      {phase.phase === "welcome" ? (
        <div className="onb-welcome" aria-hidden="true">
          <span className="onb-welcome-mark">
            {initials(phase.receipt.orgName) || (
              <CircleCheck size={28} strokeWidth={1.8} />
            )}
          </span>
        </div>
      ) : (
        <>
          {phase.phase === "receipt" && (
            <ContextReceipt receipt={phase.receipt} />
          )}
          {fraction != null && (
            <ProgressBar value={fraction} label={barLabel} />
          )}
          <Checklist rows={rows} />
          {phase.phase === "slow" && (
            <p className="onb-status">
              You can open your dashboard now. A small status line there shows
              when the read is done
              {phase.run.facts.length
                ? `; until then you'll see the ${plural(phase.run.facts.length, "fact", "facts")} read before`
                : ""}
              .
            </p>
          )}
          {phase.phase === "error" && (
            <p className="onb-status" data-tone="error">
              {phase.message}
            </p>
          )}
          {!LIVE && (
            <p className="onb-note">
              Sample data · This preview shows saved sample context. It can't
              read websites live.
            </p>
          )}
        </>
      )}
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </StepForm>
  );
};

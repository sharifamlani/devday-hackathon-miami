import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useGetIdentity } from "ra-core";
import { Database, Upload } from "lucide-react";

import { Input } from "@/components/ui/input";
import { ImportDonorsDialog } from "../import/ImportDonorsDialog";
import { loadSampleFiles, loadSampleManifest } from "../landing/sampleFiles";
import { DATA_MODE } from "../providers/local/config";
import {
  useDonors,
  useOrgProfile,
  useTargets,
  useUploadFiles,
} from "../providers/local/hooks";
import {
  SOCIAL_LABELS,
  SOCIAL_PLATFORMS,
  quarterEnd,
  useOnboarding,
  validateGoal,
  validateLinks,
  type LinkErrors,
  type OnboardingData,
  type OnlineLinks,
  type QuarterGoal,
} from "./onboardingState";
import type { TourStop } from "./tour";

const LIVE = DATA_MODE === "local";

/* ---------- Shared frame ---------- */

export interface StepFrameProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  onSkip: () => void;
}

const StepForm = ({
  title,
  lede,
  headingRef,
  onSubmit,
  onBack,
  onSkip,
  showBack = true,
  continueLabel = "Continue",
  continueDisabled = false,
  actions,
  children,
}: StepFrameProps & {
  title: ReactNode;
  lede?: ReactNode;
  onSubmit: () => void;
  showBack?: boolean;
  continueLabel?: string;
  continueDisabled?: boolean;
  /** Replaces Skip + Continue (the last step). */
  actions?: ReactNode;
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
        {actions ?? (
          <>
            <button type="button" className="onb-btn text" onClick={onSkip}>
              Skip
            </button>
            <button
              type="submit"
              className="onb-btn primary"
              disabled={continueDisabled}
            >
              {continueLabel}
            </button>
          </>
        )}
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
  prefix,
  ...input
}: ComponentProps<"input"> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  prefix?: string;
}) => {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;
  const control = (
    <Input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className="border-muted-foreground/80 bg-card text-[15px]"
      {...input}
    />
  );
  return (
    <div className={`onb-field ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      {prefix ? (
        <div className="onb-money">
          <span aria-hidden="true">{prefix}</span>
          {control}
        </div>
      ) : (
        control
      )}
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

/** Fill an empty value once, when data arrives late (org profile, identity). */
const usePrefill = (
  value: string,
  setValue: (v: string) => void,
  fallback: string | null | undefined,
) => {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !fallback) return;
    done.current = true;
    if (!value) setValue(fallback);
  }, [fallback, value, setValue]);
};

/* ---------- 1. Welcome ---------- */

export const WelcomeStep = ({
  onContinue,
  ...frame
}: StepFrameProps & {
  onContinue: (patch: Pick<OnboardingData, "personName" | "orgName">) => void;
}) => {
  const { data } = useOnboarding();
  const { data: identity } = useGetIdentity();
  const { data: profile } = useOrgProfile();
  const [personName, setPersonName] = useState(data.personName);
  const [orgName, setOrgName] = useState(data.orgName);
  usePrefill(personName, setPersonName, identity?.fullName);
  usePrefill(orgName, setOrgName, profile?.name);
  const id = useId();

  return (
    <StepForm
      {...frame}
      showBack={false}
      title={
        <>
          Less time on tasks. <strong>More time for people.</strong>
        </>
      }
      lede="Welcome to Donor Desk. Five short steps get your desk ready. Skip anything and come back later."
      onSubmit={() =>
        onContinue({ personName: personName.trim(), orgName: orgName.trim() })
      }
    >
      <div className="onb-fields two">
        <Field
          id={`${id}-name`}
          label="Your name"
          autoComplete="name"
          value={personName}
          onChange={(e) => setPersonName(e.target.value)}
        />
        <Field
          id={`${id}-org`}
          label="Organization"
          autoComplete="organization"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
        />
      </div>
    </StepForm>
  );
};

/* ---------- 2. Your mission online ---------- */

const LINK_FIELDS: {
  key: keyof OnlineLinks;
  label: string;
  placeholder: string;
}[] = [
  { key: "website", label: "Website", placeholder: "https://yourorg.org" },
  ...SOCIAL_PLATFORMS.map((platform) => ({
    key: platform,
    label: SOCIAL_LABELS[platform],
    placeholder: {
      instagram: "@yourorg",
      linkedin: "linkedin.com/company/yourorg",
      facebook: "facebook.com/yourorg",
      x: "@yourorg",
      tiktok: "@yourorg",
    }[platform],
  })),
];

export const OnlineStep = ({
  onContinue,
  ...frame
}: StepFrameProps & { onContinue: (links: OnlineLinks) => void }) => {
  const { data } = useOnboarding();
  const { data: profile } = useOrgProfile();
  const [links, setLinks] = useState<OnlineLinks>(data.links);
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
      ...current,
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
          Your mission, <strong>online.</strong>
        </>
      }
      lede="Donor Desk reads your public posts to find stories worth sharing with donors. It never posts for you."
      onSubmit={submit}
    >
      <div className="onb-fields two">
        {LINK_FIELDS.map((field) => (
          <Field
            key={field.key}
            id={`${id}-${field.key}`}
            className={field.key === "website" ? "wide" : undefined}
            label={field.label}
            type={field.key === "website" ? "url" : "text"}
            inputMode="url"
            autoComplete={field.key === "website" ? "url" : "off"}
            spellCheck={false}
            placeholder={field.placeholder}
            hint={
              field.key === "website"
                ? "Your stories and news live here. Social links: paste a link or an @handle."
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
        ))}
      </div>
      <p className="sr-only" role="status">
        {errorCount
          ? `${errorCount} ${errorCount === 1 ? "link needs" : "links need"} a fix.`
          : ""}
      </p>
      <p className="onb-note">
        {LIVE
          ? "Your website, X, LinkedIn and Instagram links are saved to Donor Desk. Facebook and TikTok stay in this browser for now."
          : "This preview keeps your links in this browser only."}
      </p>
    </StepForm>
  );
};

/* ---------- 3. Bring your donors ---------- */

const summarize = (
  donors: number | null,
  gifts: number | null,
  message: string | null,
) =>
  [
    donors != null ? `${donors} donors` : null,
    gifts != null ? `${gifts} gifts` : null,
  ]
    .filter(Boolean)
    .join(" and ") ||
  message ||
  "Your files were imported.";

export const DonorsStep = ({
  onContinue,
  onNestedDialog,
  ...frame
}: StepFrameProps & {
  onContinue: (patch: Pick<OnboardingData, "donors">) => void;
  onNestedDialog: (open: boolean) => void;
}) => {
  const { data } = useOnboarding();
  const [choice, setChoice] = useState<OnboardingData["donors"]>(data.donors);
  const [importOpen, setImportOpen] = useState(false);
  const [message, setMessage] = useState<{
    tone: "good" | "error" | "info";
    text: string;
  } | null>(null);
  const { data: donors } = useDonors();
  const countBefore = useRef<number | null>(null);
  const upload = useUploadFiles();

  const openImport = () => {
    countBefore.current = donors?.length ?? null;
    setChoice("upload");
    setMessage(null);
    setImportOpen(true);
    onNestedDialog(true);
  };

  // The import dialog doesn't report back, so compare the donor count.
  useEffect(() => {
    if (importOpen || countBefore.current == null || !donors) return;
    const added = donors.length - countBefore.current;
    countBefore.current = null;
    if (added > 0)
      setMessage({
        tone: "good",
        text: `Added ${added} ${added === 1 ? "donor" : "donors"}.`,
      });
  }, [importOpen, donors]);

  // The landing page may already have loaded the example files: never load them twice.
  const alreadyLoaded = LIVE ? (donors?.length ?? 0) : 0;

  const loadSample = async () => {
    setChoice("sample");
    if (alreadyLoaded > 0) {
      setMessage({
        tone: "good",
        text: `The example files are already loaded: ${alreadyLoaded} donors.`,
      });
      return;
    }
    if (!LIVE) {
      setMessage({
        tone: "good",
        text: "Sample donors are already loaded. Every name and amount is made up.",
      });
      return;
    }
    setMessage(null);
    try {
      const files = await loadSampleFiles(await loadSampleManifest());
      const result = await upload.mutateAsync({ files });
      setMessage({
        tone: "good",
        text: `Sample data is in: ${summarize(result.donors, result.gifts, result.message)}.`,
      });
    } catch (cause) {
      setMessage({
        tone: "error",
        text:
          cause instanceof Error
            ? cause.message
            : "We couldn't load the sample files.",
      });
    }
  };

  // The import dialog sits outside the form: its own submit must not
  // bubble (through the React tree) into Continue.
  return (
    <>
      <StepForm
        {...frame}
        title={
          <>
            Bring your <strong>donors.</strong>
          </>
        }
        lede="Start with your own list, or look around with sample data first."
        continueDisabled={upload.isPending}
        onSubmit={() => onContinue({ donors: choice })}
      >
        <div className="onb-choices">
          <button
            type="button"
            className="onb-choice onb-tile"
            aria-pressed={choice === "upload"}
            onClick={openImport}
          >
            <b>
              <Upload aria-hidden="true" size={18} strokeWidth={1.8} /> Upload a
              CSV
            </b>
            <span>
              Match your columns and check for duplicates before anything is
              added.
            </span>
          </button>
          <button
            type="button"
            className="onb-choice onb-tile"
            aria-pressed={choice === "sample"}
            disabled={upload.isPending}
            onClick={() => void loadSample()}
          >
            <b>
              <Database aria-hidden="true" size={18} strokeWidth={1.8} /> Use
              sample data
            </b>
            <span>
              {!LIVE
                ? "Already loaded in this preview."
                : alreadyLoaded > 0
                  ? `Already loaded: ${alreadyLoaded} donors.`
                  : "Load the example files from data/sample_inputs/ (fictional)."}
            </span>
          </button>
        </div>
        <div aria-live="polite">
          {upload.isPending && (
            <p className="onb-status">
              Reading the sample files. This can take a minute.
            </p>
          )}
          {message && !upload.isPending && (
            <p className="onb-status" data-tone={message.tone}>
              {message.text}
            </p>
          )}
        </div>
      </StepForm>
      <ImportDonorsDialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          onNestedDialog(open);
        }}
      />
    </>
  );
};

/* ---------- 4. Quarter goal ---------- */

const formatAmount = (amount: number | null) =>
  amount == null ? "" : amount.toLocaleString("en-US");

export const GoalStep = ({
  onContinue,
  ...frame
}: StepFrameProps & { onContinue: (goal: QuarterGoal) => void }) => {
  const { data } = useOnboarding();
  const { data: targets } = useTargets("quarter");
  const quarter = targets?.quarter;
  const [amount, setAmount] = useState(formatAmount(data.goal.amount));
  const [endDate, setEndDate] = useState(
    data.goal.endDate ?? quarterEnd(new Date()),
  );
  const [errors, setErrors] = useState<{ amount?: string; endDate?: string }>(
    {},
  );
  // A real (non-sample) goal from the service fills an empty amount.
  usePrefill(
    amount,
    setAmount,
    quarter && !quarter.goal_is_sample ? formatAmount(quarter.goal) : null,
  );
  const id = useId();

  const submit = () => {
    const result = validateGoal(amount, endDate, new Date());
    setErrors(result.errors);
    if (result.errors.amount)
      return document.getElementById(`${id}-amount`)?.focus();
    if (result.errors.endDate)
      return document.getElementById(`${id}-end`)?.focus();
    onContinue(result.goal);
  };

  return (
    <StepForm
      {...frame}
      title={
        <>
          Set your quarter <strong>goal.</strong>
        </>
      }
      lede="Your homepage tracks what you've raised against it, and the agent plans outreach around it."
      onSubmit={submit}
    >
      <div className="onb-fields two">
        <Field
          id={`${id}-amount`}
          label="Goal amount"
          prefix="$"
          inputMode="decimal"
          placeholder={quarter?.goal ? formatAmount(quarter.goal) : "150,000"}
          value={amount}
          error={errors.amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Field
          id={`${id}-end`}
          label="Quarter ends"
          type="date"
          value={endDate}
          error={errors.endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>
      <p className="onb-note">Your goal is saved in this browser for now.</p>
    </StepForm>
  );
};

/* ---------- 5. Meet your homepage ---------- */

export const TourStep = ({
  canTour,
  stops,
  onStartTour,
  onFinish,
  ...frame
}: StepFrameProps & {
  canTour: boolean;
  stops: TourStop[];
  onStartTour: () => void;
  onFinish: () => void;
}) => (
  <StepForm
    {...frame}
    title={
      <>
        Meet your <strong>homepage.</strong>
      </>
    }
    lede={
      canTour
        ? "A one-minute tour of where things are. Use Next, or press Esc to stop any time."
        : "Here's where things are on your homepage."
    }
    onSubmit={canTour ? onStartTour : onFinish}
    actions={
      canTour ? (
        <>
          <button type="button" className="onb-btn text" onClick={onFinish}>
            Skip tour
          </button>
          <button type="submit" className="onb-btn primary">
            Start the tour
          </button>
        </>
      ) : (
        <button type="submit" className="onb-btn primary">
          Go to my homepage
        </button>
      )
    }
  >
    {!canTour && (
      <ol className="onb-tour-list">
        {stops.map((stop) => (
          <li key={stop.id}>
            <b>{stop.title}</b>
            <span>{stop.body}</span>
          </li>
        ))}
      </ol>
    )}
  </StepForm>
);

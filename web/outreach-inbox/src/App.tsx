import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CaretDown,
  Check,
  CheckCircle,
  Clock,
  DotsThree,
  FileCsv,
  Headphones,
  HeartStraight,
  Tray as Inbox,
  LinkSimple,
  MagnifyingGlass,
  Microphone,
  MicrophoneSlash,
  PhoneDisconnect,
  Plus,
  ShieldCheck,
  Sparkle,
  Stack,
  UploadSimple,
  Users,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  cadence,
  combineGifts,
  dateLabel,
  defaultMapping,
  DEMO_TODAY,
  donorsFromRows,
  duplicates,
  FIELDS,
  mergeDonors,
  money,
  parseCSV,
  REQUIRED,
  validateImport,
} from "./domain";
import type { Donor, Mapping, Match } from "./domain";
import { SAMPLE_CSV, sampleDonors, withSampleScenario } from "./sample";

type Folder = "inbox" | "calls" | "snoozed" | "done";
type Audit = { name: string; other: string; gifts: number };
const total = (d: Donor) => d.gifts.reduce((a, g) => a + g.amount, 0);
const initials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const els = ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        );
        if (!els?.length) {
          e.preventDefault();
          return;
        }
        const first = els[0],
          last = els[els.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = previous;
      old?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
function downloadSample() {
  const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "fictional-donors.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function ImportDialog({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (donors: Donor[]) => void;
}) {
  const [csv, setCSV] = useState<string[][] | null>(null);
  const [isSample, setIsSample] = useState(false);
  const [name, setName] = useState("");
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [error, setError] = useState("");
  const [fictional, setFictional] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = (text: string, filename: string, builtIn = false) => {
    setIsSample(builtIn);
    try {
      const parsed = parseCSV(text);
      setCSV(parsed);
      setMapping(defaultMapping(parsed[0]));
      setName(filename);
      setError("");
      setFictional(false);
    } catch (e) {
      setError((e as Error).message);
      setCSV(null);
      setMapping(null);
    }
  };
  const validation = csv && mapping ? validateImport(csv, mapping) : null;
  const donorCount =
    validation && !validation.errors.length
      ? donorsFromRows(validation.rows, name).length
      : 0;
  return (
    <Modal
      title="Bring your donor list together"
      subtitle="Preview first. You decide what becomes a donor record."
      onClose={onClose}
      wide
    >
      <div className="modal-body">
        <div className="privacy-note">
          <ShieldCheck size={19} />
          <span>
            Hackathon workspace · Use fictional data only. Files stay in this
            browser tab.
          </span>
        </div>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="Choose a donor CSV"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 2_000_000) {
              setError("Choose a CSV smaller than 2 MB.");
              return;
            }
            if (!f.name.toLowerCase().endsWith(".csv")) {
              setError("Choose a .csv file. Export spreadsheets as CSV first.");
              return;
            }
            try {
              load(await f.text(), f.name);
            } catch {
              setError("The file could not be read. Please choose it again.");
            }
          }}
        />
        {!csv ? (
          <>
            <button
              className="upload-zone"
              onClick={() => input.current?.click()}
            >
              <span className="upload-icon">
                <UploadSimple size={27} />
              </span>
              <strong>Choose a donor CSV</strong>
              <span>Up to 2 MB · 5,000 gift rows · USD amounts</span>
            </button>
            <div className="sample-line">
              <span>Just exploring?</span>
              <button
                className="text-button"
                onClick={() => load(SAMPLE_CSV, "fictional-donors.csv", true)}
              >
                Use our fictional sample <ArrowRight />
              </button>
            </div>
            <button className="text-button small" onClick={downloadSample}>
              <ArrowDown /> Download sample CSV
            </button>
          </>
        ) : (
          <>
            <div className="file-line">
              <span className="upload-icon">
                <FileCsv size={24} />
              </span>
              <div>
                <strong>{name}</strong>
                <p>
                  {csv.length - 1} gift rows · {donorCount || "—"} donor records
                </p>
              </div>
              <button
                className="text-button"
                onClick={() => {
                  setCSV(null);
                  setMapping(null);
                }}
              >
                Change file
              </button>
            </div>
            <h3>1. Match your columns</h3>
            <p className="muted small">
              Gift IDs identify transactions. Different donor IDs remain
              separate until you approve a merge.
            </p>
            <div className="mapping-grid">
              {FIELDS.map((f) => (
                <label key={f}>
                  {f.replaceAll("_", " ")}
                  {REQUIRED.includes(f as (typeof REQUIRED)[number]) && (
                    <span aria-label="required"> *</span>
                  )}
                  <select
                    value={mapping?.[f] ?? ""}
                    onChange={(e) =>
                      setMapping({ ...mapping!, [f]: e.target.value })
                    }
                  >
                    <option value="">
                      {f === "source" ? "Use filename" : "Select column"}
                    </option>
                    {csv[0].map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <h3>2. Preview source rows</h3>
            <div className="preview-table">
              <table>
                <thead>
                  <tr>
                    {csv[0].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csv.slice(1, 5).map((row, i) => (
                    <tr key={i}>
                      {row.map((v, j) => (
                        <td key={j}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              Showing {Math.min(4, csv.length - 1)} of {csv.length - 1} rows.
              All rows are validated before import. Dates: YYYY-MM-DD.
            </p>
            {validation && validation.errors.length > 0 && (
              <div className="error" role="alert">
                <strong>Resolve these before importing</strong>
                <ul>
                  {validation.errors.slice(0, 6).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
                {validation.errors.length > 6 && (
                  <p>And {validation.errors.length - 6} more issues.</p>
                )}
              </div>
            )}
            <label className="check-label">
              <input
                type="checkbox"
                checked={fictional}
                onChange={(e) => setFictional(e.target.checked)}
              />
              This is fictional data. Replace the current demo workspace and its
              review history.
            </label>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="modal-footer">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!validation || !!validation.errors.length || !fictional}
          onClick={() => {
            if (validation && fictional) {
              const imported = donorsFromRows(validation.rows, name);
              onImport(isSample ? withSampleScenario(imported) : imported);
            }
          }}
        >
          Import & review <ArrowRight size={17} />
        </button>
      </footer>
    </Modal>
  );
}
function DuplicateDialog({
  match,
  count,
  audit,
  onMerge,
  onKeep,
  onClose,
}: {
  match?: Match;
  count: number;
  audit: Audit[];
  onMerge: (m: Match) => void;
  onKeep: (m: Match) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  return (
    <Modal
      title={match ? "One donor, two records?" : "Your review queue is clear"}
      subtitle={
        match
          ? `${count} suggestion${count === 1 ? "" : "s"} awaiting your decision. Nothing is merged automatically.`
          : "Every identity decision stays with you."
      }
      onClose={onClose}
    >
      <div className="modal-body">
        {match ? (
          <>
            <div className="review-reason">
              <Users size={20} />
              <p>{match.reason}</p>
            </div>
            <div className="compare-records">
              {[match.a, match.b].map((d, i) => (
                <section key={d.id} className="compare-card">
                  <span className="eyebrow">
                    {i === 0 ? "Primary record" : "Possible duplicate"}
                  </span>
                  <span className={`avatar tone-${i}`}>{initials(d.name)}</span>
                  <h3>{d.name}</h3>
                  <p>{d.email}</p>
                  <strong>{money(total(d))}</strong>
                  <p>
                    {d.gifts.length} gifts · ID: {d.id}
                  </p>
                  <ul>
                    {d.gifts.map((g) => (
                      <li key={g.id}>
                        {dateLabel(g.date)} <b>{money(g.amount)}</b>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <div className="privacy-note">
              <Stack size={20} />
              <span>
                Keep the primary name and email. Retain all unique gift IDs and
                every source row. Identical transaction IDs count once.
              </span>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </>
        ) : (
          <div className="empty-state">
            <CheckCircle size={42} weight="light" />
            <h3>One less thing on your list.</h3>
            <p>New suggestions will appear when you import another file.</p>
          </div>
        )}
        {audit.length > 0 && (
          <details className="audit">
            <summary>Review history this session ({audit.length})</summary>
            {audit.map((a, i) => (
              <p key={i}>
                Staff approved: {a.other} → {a.name}. {a.gifts} unique gifts
                retained.
              </p>
            ))}
          </details>
        )}
      </div>
      <footer className="modal-footer">
        {match ? (
          <>
            <button
              className="button secondary"
              onClick={() => {
                setError("");
                onKeep(match);
              }}
            >
              Keep separate
            </button>
            <button
              className="button primary"
              onClick={() => {
                try {
                  combineGifts(match.a.gifts, match.b.gifts);
                  onMerge(match);
                  setError("");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Approve merge <Check size={17} />
            </button>
          </>
        ) : (
          <button className="button primary" onClick={onClose}>
            Back to inbox <ArrowRight />
          </button>
        )}
      </footer>
    </Modal>
  );
}
function CallDialog({
  donor,
  onClose,
  onOutcome,
}: {
  donor: Donor;
  onClose: () => void;
  onOutcome: (text: string) => void;
}) {
  const [joined, setJoined] = useState(false);
  const [wasJoined, setWasJoined] = useState(false);
  const [muted, setMuted] = useState(true);
  const [left, setLeft] = useState(false);
  const [outcome, setOutcome] = useState("Staff follow-up requested");
  return (
    <Modal
      title={`Call with ${donor.name}`}
      subtitle="Voice simulation · No microphone, audio, or phone connection"
      onClose={onClose}
    >
      <div className="modal-body">
        <div className="call-status">
          <span className="live-dot" />
          <strong>
            {left
              ? "Simulation ended"
              : joined
                ? "You joined the simulation"
                : "AI call simulation"}
          </strong>
          <span>{clock(donor.call?.seconds ?? 0)}</span>
        </div>
        <div className="call-brief">
          <span className="eyebrow">Why staff attention is needed</span>
          <h3>A person asked for a person.</h3>
          <p>{donor.call?.reason}</p>
        </div>
        <div className="brief-stats">
          <div>
            <span>Giving history</span>
            <strong>
              {money(total(donor))} · {donor.gifts.length} gifts
            </strong>
          </div>
          <div>
            <span>Briefing note · fictional</span>
            <strong>
              {donor.note ?? "No additional notes in this sample."}
            </strong>
          </div>
        </div>
        <h3>
          Conversation preview{" "}
          <span className="tiny-tag">Sample transcript</span>
        </h3>
        <div className="transcript">
          <p>
            <span>Assistant · 06:12</span>We’ve been preparing our next family
            resource day. Would you like to hear more?
          </p>
          <p>
            <span>{donor.name.split(" ")[0]} · 06:24</span>I’d love to help in
            person. Could someone on your team tell me about volunteering?
          </p>
          <p>
            <span>Assistant · 06:35</span>Of course. I can ask a staff member to
            join us.
          </p>
          {joined && (
            <p className="staff-line">
              <span>You · simulation</span>Staff joined with the donor briefing
              available.
            </p>
          )}
        </div>
        {joined && (
          <div className="join-notice" role="status">
            {muted
              ? "Microphone muted in simulation."
              : "Microphone enabled in simulation."}{" "}
            No device access is requested.
          </div>
        )}
        {left && (
          <label className="outcome-label">
            Record a next step
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            >
              <option>Staff follow-up requested</option>
              <option>Send volunteer information</option>
              <option>Call back next week</option>
            </select>
          </label>
        )}
      </div>
      <footer className="modal-footer">
        {left ? (
          <>
            <button className="button secondary" onClick={onClose}>
              Close
            </button>
            <button
              className="button primary"
              onClick={() => onOutcome(outcome)}
            >
              Save outcome <Check />
            </button>
          </>
        ) : joined ? (
          <>
            <button
              className="button secondary"
              aria-pressed={!muted}
              onClick={() => setMuted(!muted)}
            >
              {muted ? <MicrophoneSlash /> : <Microphone />}
              {muted ? "Unmute simulation" : "Mute simulation"}
            </button>
            <button
              className="button danger"
              onClick={() => {
                setJoined(false);
                setLeft(true);
              }}
            >
              <PhoneDisconnect /> Leave simulation
            </button>
          </>
        ) : (
          <>
            <span className="muted small">
              Join with the briefing already in hand.
            </span>
            <button
              className="button primary"
              onClick={() => {
                setJoined(true);
                setWasJoined(true);
              }}
            >
              <Headphones />
              {wasJoined ? "Rejoin simulation" : "Join simulation"}
            </button>
          </>
        )}
      </footer>
    </Modal>
  );
}
function DraftDialog({
  donor,
  onClose,
  onApprove,
}: {
  donor: Donor;
  onClose: () => void;
  onApprove: (text: string) => void;
}) {
  const [text, setText] = useState(
    `Hi ${donor.name.split(" ")[0]},\n\nThank you for being part of Tidepath’s family resource program. We’re preparing our next resource day, and I wanted to share an update and hear how you’re doing.\n\nIf you’d like, I’d be happy to tell you what’s coming up. No pressure at all.\n\nWarmly,\nDenise · Tidepath Family Alliance`,
  );
  return (
    <Modal
      title="Make the check-in your own"
      subtitle="Example draft · Fictional program update · No model generation or sending"
      onClose={onClose}
    >
      <div className="modal-body">
        <label className="draft-label">
          To <strong>{donor.name}</strong>
          <span>{donor.email}</span>
        </label>
        <label className="outcome-label">
          Your message
          <textarea
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="privacy-note">
          <ShieldCheck size={20} />
          <span>
            Approval records a local task for staff. No email, text, or call is
            sent.
          </span>
        </div>
        <details className="source-details">
          <summary>
            <LinkSimple /> Example content source
          </summary>
          <p>
            Fictional program note TP-01: “The next family resource day is being
            prepared.” This is sample context, not verified nonprofit news.
          </p>
        </details>
      </div>
      <footer className="modal-footer">
        <button className="button secondary" onClick={onClose}>
          Keep editing later
        </button>
        <button
          className="button primary"
          disabled={!text.trim()}
          onClick={() => onApprove(text)}
        >
          Approve for staff follow-up <Check />
        </button>
      </footer>
    </Modal>
  );
}

export default function App() {
  const [donors, setDonors] = useState<Donor[]>(sampleDonors);
  const [selected, setSelected] = useState("rosa");
  const [folder, setFolder] = useState<Folder>("inbox");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [dialog, setDialog] = useState<
    "import" | "duplicates" | "call" | "draft" | "reset" | null
  >(null);
  const [callId, setCallId] = useState("elena");
  const [rejected, setRejected] = useState<string[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<Donor[] | null>(null);
  const [detailMobile, setDetailMobile] = useState(false);
  const matches = useMemo(
    () => duplicates(donors).filter((m) => !rejected.includes(m.key)),
    [donors, rejected],
  );
  const active = donors.filter((d) => d.call && d.status !== "done");
  const pending = donors.filter((d) => !d.status);
  const late = pending.filter((d) => cadence(d).overdue);
  const visible = donors
    .filter((d) => {
      const correctFolder =
        folder === "inbox"
          ? !d.status
          : folder === "calls"
            ? !!d.call && d.status !== "done"
            : d.status === folder;
      const searchable = `${d.name} ${d.email}`
        .toLowerCase()
        .includes(search.toLowerCase());
      return (
        correctFolder && searchable && (filter !== "late" || cadence(d).overdue)
      );
    })
    .sort(
      (a, b) =>
        Number(!!b.call) - Number(!!a.call) ||
        Number(cadence(b).overdue) - Number(cadence(a).overdue) ||
        a.name.localeCompare(b.name),
    );
  const donor = donors.find((d) => d.id === selected);
  const c = donor ? cadence(donor) : null;
  const announce = (s: string) => setNotice(s);
  function updateDonor(id: string, patch: Partial<Donor>) {
    setDonors((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    setUndo(null);
  }
  function changeFolder(f: Folder) {
    setFolder(f);
    setFilter("all");
    setSearch("");
    setDetailMobile(false);
  }
  function showDonor(id: string) {
    setSelected(id);
    setDetailMobile(true);
  }
  function reset() {
    setDonors(sampleDonors());
    setSelected("rosa");
    setFolder("inbox");
    setFilter("all");
    setSearch("");
    setRejected([]);
    setAudit([]);
    setUndo(null);
    setDialog(null);
    announce("Fictional demo restored.");
  }
  const callDonor = donors.find((d) => d.id === callId);
  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Workspace">
        <a
          href="#inbox"
          className="brand-mark"
          aria-label="Kindred home"
          onClick={() => changeFolder("inbox")}
        >
          <HeartStraight size={25} weight="fill" />
        </a>
        <div className="rail-links">
          <button
            className="rail-button current"
            aria-label="Outreach workspace"
            onClick={() => changeFolder("inbox")}
          >
            <Inbox size={22} />
          </button>
          <button
            className="rail-button"
            aria-label="Review duplicate donors"
            onClick={() => setDialog("duplicates")}
          >
            <Users size={22} />
          </button>
          <button
            className="rail-button"
            aria-label="Import donor data"
            onClick={() => setDialog("import")}
          >
            <UploadSimple size={22} />
          </button>
        </div>
        <button
          className="rail-button rail-bottom"
          aria-label="Reset fictional demo"
          onClick={() => setDialog("reset")}
        >
          <DotsThree size={24} />
        </button>
        <span className="staff-avatar" title="Denise · fictional staff member">
          D
        </span>
      </aside>
      <aside className="sidebar">
        <div className="wordmark">
          kindred<span>Outreach, with care.</span>
        </div>
        <button
          className="workspace-switch"
          onClick={() =>
            announce(
              "Tidepath Family Alliance is a fictional nonprofit workspace for this demo.",
            )
          }
        >
          <span className="workspace-symbol">
            <HeartStraight weight="fill" />
          </span>
          <span>
            Tidepath Alliance<small>Demo workspace</small>
          </span>
          <CaretDown size={14} />
        </button>
        <button
          className="button primary import-button"
          onClick={() => setDialog("import")}
        >
          <Plus size={18} /> Import donor list
        </button>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="Outreach folders">
          {(
            [
              {
                id: "inbox",
                text: "Outreach inbox",
                icon: Inbox,
                count: pending.length,
              },
              {
                id: "calls",
                text: "Active calls",
                icon: Headphones,
                count: active.length,
              },
              {
                id: "snoozed",
                text: "Snoozed",
                icon: Clock,
                count: donors.filter((d) => d.status === "snoozed").length,
              },
              {
                id: "done",
                text: "Completed",
                icon: CheckCircle,
                count: donors.filter((d) => d.status === "done").length,
              },
            ] as const
          ).map(({ id, text, icon: Icon, count }) => (
            <button
              key={id}
              className={`nav-item ${folder === id ? "selected" : ""}`}
              aria-current={folder === id ? "page" : undefined}
              onClick={() => changeFolder(id)}
            >
              <Icon size={19} weight={folder === id ? "fill" : "regular"} />
              <span>{text}</span>
              <b>{count}</b>
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <button className="nav-item" onClick={() => setDialog("duplicates")}>
          <Stack size={19} />
          <span>Duplicate review</span>
          {matches.length > 0 && (
            <b className="yellow-count">{matches.length}</b>
          )}
        </button>
        <div className="sidebar-footer">
          <ShieldCheck size={19} />
          <strong>A safe place to try things.</strong>
          <p>All people and gifts are fictional. Changes last in this tab.</p>
          <button className="text-button" onClick={() => setDialog("reset")}>
            Reset demo <ArrowUpRight size={14} />
          </button>
        </div>
      </aside>
      <main id="inbox" className="main">
        <header className="topbar">
          <div>
            <span>Tidepath Family Alliance</span>
            <span className="slash">/</span>
            <strong>Outreach</strong>
          </div>
          <span className="demo-pill">
            <span /> Fictional demo
          </span>
          <button
            className="icon-button"
            aria-label="Show attention summary"
            onClick={() =>
              announce(
                `${late.length} donors have a missed expected gift; ${active.length} call simulation needs staff attention.`,
              )
            }
          >
            <Bell size={21} />
          </button>
        </header>
        <div className="page-heading">
          <div>
            <p className="eyebrow">SATURDAY, NOVEMBER 7</p>
            <h1>
              {folder === "calls"
                ? "A conversation, continued."
                : folder === "done"
                  ? "Care, followed through."
                  : folder === "snoozed"
                    ? "A little breathing room."
                    : "Every connection matters."}
            </h1>
            <p>Your next thoughtful conversation starts here.</p>
          </div>
          <span className="date-chip">
            <Clock size={15} /> Demo date · Nov 7, 2026
          </span>
        </div>
        <section className="inbox-layout">
          <div className={`inbox-panel ${detailMobile ? "mobile-hide" : ""}`}>
            <div className="inbox-header">
              <div>
                <h2>
                  {folder === "inbox"
                    ? "Outreach inbox"
                    : folder === "calls"
                      ? "Active calls"
                      : folder === "done"
                        ? "Completed"
                        : "Snoozed"}{" "}
                  <span>{visible.length}</span>
                </h2>
                <p>
                  {folder === "inbox"
                    ? "A small list. A meaningful difference."
                    : folder === "calls"
                      ? "Simulated conversations ready for a human."
                      : folder === "done"
                        ? "Reviewed and recorded for your team."
                        : "Paused until you decide to restore them."}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Import a donor list"
                onClick={() => setDialog("import")}
              >
                <UploadSimple size={20} />
              </button>
            </div>
            <div className="search-line">
              <MagnifyingGlass size={19} />
              <input
                aria-label="Search donors"
                placeholder="Search people or email addresses"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  className="icon-button"
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="list-tabs" aria-label="Inbox filters">
              <button
                className={filter === "all" ? "active" : ""}
                onClick={() => setFilter("all")}
              >
                All people{" "}
                <span>
                  {
                    (folder === "inbox"
                      ? pending
                      : donors.filter((d) =>
                          folder === "calls"
                            ? !!d.call && d.status !== "done"
                            : d.status === folder,
                        )
                    ).length
                  }
                </span>
              </button>
              <button
                className={filter === "late" ? "active" : ""}
                onClick={() => setFilter("late")}
              >
                Missed gifts{" "}
                <span>
                  {
                    donors.filter(
                      (d) =>
                        (folder === "inbox"
                          ? !d.status
                          : folder === "calls"
                            ? !!d.call && d.status !== "done"
                            : d.status === folder) && cadence(d).overdue,
                    ).length
                  }
                </span>
              </button>
            </div>
            {matches.length > 0 && folder === "inbox" && (
              <button
                className="duplicate-banner"
                onClick={() => setDialog("duplicates")}
              >
                <Stack size={19} />
                <span>
                  <b>
                    {matches.length} possible duplicate
                    {matches.length > 1 ? "s" : ""}
                  </b>{" "}
                  · A quick review keeps the whole story.
                </span>
                <ArrowRight size={18} />
              </button>
            )}
            <div className="donor-list">
              {visible.length ? (
                visible.map((d, i) => {
                  const cd = cadence(d);
                  const isCall = !!d.call && d.status !== "done";
                  return (
                    <div
                      className={`donor-row ${selected === d.id ? "is-selected" : ""} ${isCall ? "has-call" : ""}`}
                      key={d.id}
                    >
                      <button
                        className="donor-open"
                        onClick={() => showDonor(d.id)}
                        aria-label={`Open ${d.name}`}
                        aria-pressed={selected === d.id}
                      >
                        <span className={`avatar tone-${i % 5}`}>
                          {initials(d.name)}
                        </span>
                        <span className="row-copy">
                          <strong>
                            {d.name}
                            {d.priority && (
                              <span
                                className="priority-mark"
                                title="Priority supporter"
                              >
                                <Sparkle size={13} weight="fill" />
                              </span>
                            )}
                          </strong>
                          <span>
                            {d.status === "done"
                              ? (d.outcome ?? "Reviewed by staff")
                              : d.status === "snoozed"
                                ? "Paused by you · restore when ready"
                                : isCall
                                  ? "Asked to speak with your team"
                                  : cd.overdue
                                    ? `Expected ${dateLabel(cd.expected!)} · ${cd.daysLate} days ago`
                                    : d.gifts.length < 3
                                      ? "A little more history will help"
                                      : "A good moment to say thank you"}
                          </span>
                          <span className="row-tags">
                            {isCall ? (
                              <span className="status-tag call-tag">
                                <span className="live-dot" />
                                On a call · {clock(d.call!.seconds)}
                              </span>
                            ) : d.status === "done" ? (
                              <span className="status-tag done-tag">
                                <Check size={12} /> Completed
                              </span>
                            ) : cd.overdue ? (
                              <span className="status-tag late-tag">
                                Missed gift
                              </span>
                            ) : (
                              <span className="status-tag">
                                {d.gifts.length < 3
                                  ? "New connection"
                                  : "Stewardship"}
                              </span>
                            )}
                            <span className="row-amount">
                              {money(total(d))} total
                            </span>
                          </span>
                        </span>
                      </button>
                      {isCall ? (
                        <button
                          className="join-small"
                          onClick={() => {
                            setCallId(d.id);
                            setDialog("call");
                          }}
                        >
                          <Headphones size={15} /> Join
                        </button>
                      ) : (
                        <ArrowRight className="row-arrow" size={17} />
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="empty-state">
                  <Inbox size={40} weight="light" />
                  <h3>
                    {search
                      ? "No matching people"
                      : "You’re all caught up here."}
                  </h3>
                  <p>
                    {search
                      ? "Try another name or email address."
                      : filter === "late"
                        ? "No missed gifts in this folder."
                        : "Import a fictional donor list or choose another folder."}
                  </p>
                  {search && (
                    <button
                      className="button secondary"
                      onClick={() => setSearch("")}
                    >
                      Clear search
                    </button>
                  )}
                </div>
              )}
            </div>
            <footer className="list-footer">
              <ShieldCheck size={15} />
              <span>Human decisions. Complete gift history.</span>
              <span>{visible.length} people</span>
            </footer>
          </div>
          <aside
            className={`detail-panel ${detailMobile ? "mobile-show" : ""}`}
            aria-label="Donor briefing"
          >
            {donor && c ? (
              <>
                <header className="detail-header">
                  <button
                    className="icon-button mobile-back"
                    aria-label="Back to donor list"
                    onClick={() => setDetailMobile(false)}
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <span>THE PERSON BEHIND THE RECORD</span>
                  <button
                    className="icon-button"
                    aria-label={`Review duplicates for ${donor.name}`}
                    onClick={() => setDialog("duplicates")}
                  >
                    <DotsThree size={22} />
                  </button>
                </header>
                <div className="profile">
                  <span className="avatar profile-avatar tone-0">
                    {initials(donor.name)}
                  </span>
                  <h2>{donor.name}</h2>
                  <p>{donor.email}</p>
                  <span className="profile-caption">
                    {c.label} <span>·</span> Since{" "}
                    {donor.gifts
                      .map((g) => g.date)
                      .sort()[0]
                      ?.slice(0, 4)}
                  </span>
                </div>
                <div className="profile-stats">
                  <div>
                    <strong>{money(total(donor))}</strong>
                    <span>Lifetime giving</span>
                  </div>
                  <div>
                    <strong>{donor.gifts.length}</strong>
                    <span>Recorded gifts</span>
                  </div>
                </div>
                {donor.status ? (
                  <div className="attention-card resolved">
                    <CheckCircle size={20} />
                    <span className="eyebrow">
                      {donor.status === "done"
                        ? "REVIEWED BY STAFF"
                        : "SNOOZED BY YOU"}
                    </span>
                    <h3>
                      {donor.status === "done"
                        ? "The next step is recorded."
                        : "A pause, with intention."}
                    </h3>
                    <p>
                      {donor.outcome ??
                        "Restore this person when you’re ready to follow up."}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => {
                        updateDonor(donor.id, {
                          status: undefined,
                          outcome: undefined,
                        });
                        announce(
                          `${donor.name} restored to the outreach inbox.`,
                        );
                      }}
                    >
                      Restore to inbox <ArrowRight />
                    </button>
                  </div>
                ) : donor.call ? (
                  <div className="attention-card call-attention">
                    <Headphones size={20} />
                    <span className="eyebrow">
                      STAFF REQUESTED · SIMULATION
                    </span>
                    <h3>A familiar voice would help.</h3>
                    <p>{donor.call.reason}</p>
                    <button
                      className="button primary"
                      onClick={() => {
                        setCallId(donor.id);
                        setDialog("call");
                      }}
                    >
                      View briefing & join <ArrowRight />
                    </button>
                  </div>
                ) : (
                  <div
                    className={`attention-card ${c.overdue ? "" : "neutral"}`}
                  >
                    <span className="attention-icon">
                      {c.overdue ? (
                        <WarningCircle size={20} />
                      ) : (
                        <HeartStraight size={20} />
                      )}
                    </span>
                    <span className="eyebrow">
                      {c.overdue
                        ? "WHY A CHECK-IN HELPS"
                        : "A MOMENT FOR CONNECTION"}
                    </span>
                    <h3>
                      {c.overdue
                        ? "A familiar gift is missing."
                        : c.expected
                          ? "Right on their own rhythm."
                          : "Every history starts somewhere."}
                    </h3>
                    <p>
                      {c.overdue
                        ? `${donor.name.split(" ")[0]} usually gives ${c.label === "Monthly supporter" ? "monthly" : c.label.toLowerCase().replace("usually ", "")}. The next gift was expected ${dateLabel(c.expected!)}. No gift is recorded after a 7-day grace period.`
                        : c.expected
                          ? `The next gift is expected around ${dateLabel(c.expected)}. There’s no missed-gift alert today.`
                          : "At least three gift dates are needed to estimate a personal giving rhythm."}
                    </p>
                    {c.expected && (
                      <div className="expected-date">
                        <span>
                          {c.overdue
                            ? `${c.daysLate} days since expected gift`
                            : "Expected next gift"}
                        </span>
                        <strong>
                          {c.overdue
                            ? `Review from ${dateLabel(c.graceEnd!)}`
                            : dateLabel(c.expected)}
                        </strong>
                      </div>
                    )}
                    <p className="payment-note">
                      Payment status unknown. A missing gift does not mean a
                      card failed.
                    </p>
                  </div>
                )}
                <section className="history-section">
                  <div className="section-heading">
                    <h3>Giving history</h3>
                    <span>{donor.gifts.length} gifts</span>
                  </div>
                  <div className="gift-timeline">
                    {[...donor.gifts]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((g) => (
                        <details className="gift" key={g.id}>
                          <summary>
                            <span className="gift-dot">
                              <HeartStraight size={12} weight="fill" />
                            </span>
                            <span>
                              <strong>{dateLabel(g.date)}</strong>
                              <small>{g.source}</small>
                            </span>
                            <b>{money(g.amount)}</b>
                            <LinkSimple size={14} />
                          </summary>
                          <div className="gift-source">
                            <strong>Source transaction {g.id}</strong>
                            {g.refs.map((ref) => (
                              <p key={ref}>{ref}</p>
                            ))}
                            <span>Fictional gift · Source row retained</span>
                          </div>
                        </details>
                      ))}
                  </div>
                </section>
                <details className="source-details calculation">
                  <summary>
                    <LinkSimple size={16} /> How this is calculated
                  </summary>
                  <p>
                    Demo date: {dateLabel(DEMO_TODAY)}. At least three gift
                    dates are required. Calendar-month gifts use the next
                    month’s date; other histories use the median interval.
                    Review starts seven days after the expected date. No future
                    gifts are used and this is not a prediction of willingness
                    to give.
                  </p>
                  <p>Dates used: {c.evidence.map(dateLabel).join("; ")}.</p>
                </details>
                <section className="staff-note">
                  <span className="note-icon">
                    <Users size={17} />
                  </span>
                  <div>
                    <h3>A note for your conversation</h3>
                    <p>
                      {donor.note ??
                        "Start with gratitude. Ask how they’re doing before discussing giving."}
                    </p>
                    <span>Fictional staff note</span>
                  </div>
                </section>
                <footer className="detail-actions">
                  {!donor.status ? (
                    <>
                      <button
                        className="button primary"
                        onClick={() => setDialog("draft")}
                      >
                        <Sparkle size={17} /> Prepare a check-in{" "}
                        <ArrowUpRight size={17} />
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => {
                          updateDonor(donor.id, { status: "snoozed" });
                          announce(
                            `${donor.name} snoozed. Restore them from the Snoozed folder.`,
                          );
                        }}
                      >
                        <Clock size={17} /> Snooze
                      </button>
                    </>
                  ) : (
                    <p>
                      <CheckCircle size={18} /> This person has a recorded next
                      step.
                    </p>
                  )}
                </footer>
              </>
            ) : (
              <div className="empty-state">
                <Users size={40} weight="light" />
                <h3>Choose a person</h3>
                <p>Their story and your next step will appear here.</p>
              </div>
            )}
          </aside>
        </section>
        <footer className="page-footer">
          <HeartStraight size={14} /> A little less admin. A little more human.
          <span>Kindred · Hackathon prototype</span>
        </footer>
      </main>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle size={19} />
          <span>{notice}</span>
          {undo && (
            <button
              onClick={() => {
                setDonors(undo);
                setUndo(null);
                setAudit((a) => a.slice(0, -1));
                announce(
                  "Last merge undone. Both donor records and their source gifts are restored.",
                );
              }}
            >
              Undo merge
            </button>
          )}
          <button
            aria-label="Dismiss notification"
            className="icon-button"
            onClick={() => setNotice("")}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {dialog === "import" && (
        <ImportDialog
          onClose={() => setDialog(null)}
          onImport={(ds) => {
            setDonors(ds);
            setSelected(ds[0]?.id ?? "");
            setRejected([]);
            setAudit([]);
            setUndo(null);
            setFolder("inbox");
            setFilter("all");
            setSearch("");
            setDialog(null);
            announce(
              `Imported ${ds.length} fictional donor records. Review suggested matches before merging.`,
            );
          }}
        />
      )}
      {dialog === "duplicates" && (
        <DuplicateDialog
          match={matches[0]}
          count={matches.length}
          audit={audit}
          onClose={() => setDialog(null)}
          onKeep={(m) => {
            setRejected([...rejected, m.key]);
            announce(`${m.a.name} and ${m.b.name} kept as separate records.`);
          }}
          onMerge={(m) => {
            const merged = mergeDonors(donors, m.a.id, m.b.id);
            setUndo(donors);
            setDonors(merged);
            setSelected(m.a.id);
            setAudit([
              ...audit,
              {
                name: m.a.name,
                other: m.b.name,
                gifts: merged.find((d) => d.id === m.a.id)!.gifts.length,
              },
            ]);
            announce(
              `Merged into ${m.a.name}. Every unique gift and source row is retained.`,
            );
          }}
        />
      )}
      {dialog === "call" && callDonor && (
        <CallDialog
          donor={callDonor}
          onClose={() => setDialog(null)}
          onOutcome={(outcome) => {
            updateDonor(callDonor.id, {
              call: undefined,
              status: "done",
              outcome,
            });
            setDialog(null);
            setSelected(callDonor.id);
            announce("Simulation outcome saved. No call was made.");
          }}
        />
      )}
      {dialog === "draft" && donor && (
        <DraftDialog
          key={donor.id}
          donor={donor}
          onClose={() => setDialog(null)}
          onApprove={(text) => {
            updateDonor(donor.id, {
              status: "done",
              outcome: `Staff follow-up approved · ${text.length} characters. No message sent.`,
              note: `${donor.note ?? ""}\nApproved draft:\n${text}`.trim(),
            });
            setDialog(null);
            announce("Draft approved for staff follow-up. No message sent.");
          }}
        />
      )}
      {dialog === "reset" && (
        <Modal
          title="Start fresh with the sample?"
          subtitle="This clears imports, merge decisions, and follow-up outcomes in this tab."
          onClose={() => setDialog(null)}
        >
          <div className="modal-body">
            <p>
              The original fictional people and gifts will be restored. No
              external records are affected.
            </p>
          </div>
          <footer className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setDialog(null)}
            >
              Keep my work
            </button>
            <button className="button primary" onClick={reset}>
              Reset fictional demo
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

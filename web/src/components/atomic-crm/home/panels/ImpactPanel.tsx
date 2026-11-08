import { useState } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  useCommunityStats,
  useContextStatus,
  useRefreshContext,
} from "../../providers/local/crmHooks";
import {
  useOrgContext,
  useOrgProfile,
  useTargets,
} from "../../providers/local/hooks";
import type { CommunityStats } from "../../providers/local/crmTypes";
import type { ContextFact, DonationTarget } from "../../providers/local/types";
import { DATA_MODE } from "../../providers/local";
import { focusRing } from "../tile";
import "./impact-panel.css";

/** A fact as the panel reads it. The service also sends `kind` and `title`; the parser may not pass them on yet. */
export type ImpactFact = ContextFact & {
  kind?: string | null;
  title?: string | null;
};

export const KIND_LABELS: Record<string, string> = {
  success_story: "Success story",
  use_of_funds: "Where the money goes",
  org_health: "How we're doing",
  program_update: "Program update",
};
const kindLabel = (f: ImpactFact) =>
  (f.kind && KIND_LABELS[f.kind]) || f.priority || "Other";

export const NO_FACTS = "No facts yet — run onboarding's context step";
export const NO_COMMUNITY = "No Community records yet";
const FACTS_SHOWN = 8;

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in into is it its of on or that the their this to was were which with".split(
    " ",
  ),
);
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/(\d),(?=\d)/g, "$1")
      .split(/[^a-z0-9$.%]+/)
      .map((w) => w.replace(/^\.+|\.+$/g, ""))
      .filter((w) => w && !STOPWORDS.has(w)),
  );
const jaccard = (a: Set<string>, b: Set<string>) => {
  let both = 0;
  for (const w of a) if (b.has(w)) both += 1;
  const union = a.size + b.size - both;
  return union === 0 ? 1 : both / union;
};
const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
export const NEAR_DUPLICATE = 0.6;

/**
 * Newest first, one row per statement: exact repeats collapse, and so do near-repeats
 * (same source domain and date, word overlap >= 0.6), keeping the longer wording.
 */
export const listFacts = (facts: ImpactFact[]): ImpactFact[] => {
  const sorted = [...facts].sort((a, b) =>
    (b.posted_at ?? "").localeCompare(a.posted_at ?? ""),
  );
  const kept: { fact: ImpactFact; words: Set<string> }[] = [];
  for (const f of sorted) {
    const w = words(f.fact);
    const exact = f.fact.trim().toLowerCase();
    const twin = kept.find(
      (k) =>
        k.fact.fact.trim().toLowerCase() === exact ||
        (k.fact.posted_at === f.posted_at &&
          domainOf(k.fact.source_url) === domainOf(f.source_url) &&
          jaccard(k.words, w) >= NEAR_DUPLICATE),
    );
    if (!twin) kept.push({ fact: f, words: w });
    else if (f.fact.length > twin.fact.fact.length) {
      twin.fact = f;
      twin.words = w;
    }
  }
  return kept.map((k) => k.fact);
};

const monthShort = (m: string) =>
  new Date(2000, Number(m) - 1, 1).toLocaleString("en-US", { month: "short" });

/** "2026-11-08 10:06:52" -> "Nov 8, 10:06 AM" (the service's own clock; no zone is guessed). */
export const formatRefreshed = (iso: string | null | undefined) => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[4]);
  return `${monthShort(m[2])} ${Number(m[3])}, ${h % 12 || 12}:${m[5]} ${h < 12 ? "AM" : "PM"}`;
};

const formatPosted = (d: string | null) => {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${monthShort(m[2])} ${Number(m[3])}, ${m[1]}` : null;
};

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
};

type Bucket = { label: string; count: number };
const dimension = (stats: CommunityStats | undefined, name: string): Bucket[] =>
  stats?.breakdowns.find((b) => b.dimension.toLowerCase() === name)?.buckets ??
  [];

const q4Line = (q: DonationTarget | undefined) => {
  if (!q) return null;
  if (q.goal == null) return `${q.label}: ${usd(q.raised)} raised`;
  const pct = q.goal > 0 ? ` (${Math.round((q.raised / q.goal) * 100)}%)` : "";
  return `${q.label}: ${usd(q.raised)} of ${usd(q.goal)}${pct}`;
};

/** The plain text "Copy for a grant report" puts on the clipboard. Only what is on screen. */
export const grantSummary = ({
  quarter,
  facts,
  stats,
}: {
  quarter: DonationTarget | undefined;
  facts: ImpactFact[];
  stats: CommunityStats | undefined;
}) => {
  const lines: string[] = ["Impact & story"];
  const q = q4Line(quarter);
  if (q) lines.push("", q);
  const top = listFacts(facts).slice(0, 3);
  if (top.length) {
    lines.push("", "What we've done");
    top.forEach((f) => lines.push(`- ${f.fact} (${f.source_url})`));
  }
  const total = stats?.total ?? 0;
  const section = (title: string, buckets: Bucket[]) =>
    buckets.length
      ? [`${title}: ${buckets.map((b) => `${b.label} ${b.count}`).join(", ")}`]
      : [];
  const serve = [
    ...section("By zip", dimension(stats, "zip")),
    ...section("By program", dimension(stats, "programs")),
  ];
  if (total > 0 && serve.length) {
    lines.push(
      "",
      `Who we serve (self-reported, ${total} people in the Community tab)`,
      ...serve,
    );
  }
  return lines.join("\n");
};

const Bars = ({ title, buckets }: { title: string; buckets: Bucket[] }) => {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div data-testid={`impact-bars-${title.toLowerCase()}`}>
      <h5 className="mb-2 text-sm font-semibold">{title}</h5>
      <dl className="impact-panel-rows">
        {buckets.map((b) => (
          <div key={b.label} className="contents">
            <dt
              className={cn(
                "truncate",
                b.label === "not recorded" && "text-muted-foreground italic",
              )}
            >
              {b.label}
            </dt>
            <dd className="m-0">
              <div
                className="impact-panel-bar impact-panel-bar-sm"
                aria-hidden="true"
              >
                <span style={{ width: `${(b.count / max) * 100}%` }} />
              </div>
            </dd>
            <dd
              className="m-0 text-right font-semibold tabular-nums"
              data-count
            >
              {b.count}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

export const ImpactView = ({
  quarter,
  targetsPending = false,
  facts,
  stats,
  contextCached = false,
  contextSourceStatus = {},
  canRefresh = false,
  refreshing = false,
  refreshError = null,
  onRefresh,
  refreshedAt,
  onCopy,
  copied = false,
  defaultServeOpen = false,
  defaultShowAll = false,
}: {
  quarter: DonationTarget | undefined;
  targetsPending?: boolean;
  facts: ImpactFact[];
  stats: CommunityStats | undefined;
  contextCached?: boolean;
  contextSourceStatus?: Record<string, string>;
  canRefresh?: boolean;
  refreshing?: boolean;
  refreshError?: string | null;
  onRefresh?: () => void;
  refreshedAt?: string | null;
  onCopy: () => void;
  copied?: boolean;
  defaultServeOpen?: boolean;
  defaultShowAll?: boolean;
}) => {
  const [serveOpen, setServeOpen] = useState(defaultServeOpen);
  const [showAll, setShowAll] = useState(defaultShowAll);
  const refreshed = formatRefreshed(refreshedAt);
  const list = listFacts(facts);
  const shown = showAll ? list : list.slice(0, FACTS_SHOWN);
  const zip = dimension(stats, "zip");
  const programs = dimension(stats, "programs");
  const total = stats?.total ?? 0;
  const hasCommunity = total > 0 && (zip.length > 0 || programs.length > 0);
  const percent =
    quarter && quarter.goal != null && quarter.goal > 0
      ? Math.round((quarter.raised / quarter.goal) * 100)
      : null;

  return (
    <div className="impact-panel" data-testid="impact-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-2xl font-semibold tracking-tight">
            Impact &amp; story
          </h3>
          {refreshed && (
            <p className="mt-1 text-sm text-muted-foreground">
              Last refreshed {refreshed}
            </p>
          )}
          {contextCached && (
            <p className="mt-1 text-sm text-muted-foreground">
              Saved sample context · this preview cannot run live research.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold hover:bg-quiet disabled:opacity-60",
                focusRing,
              )}
            >
              {refreshing ? "Refreshing research…" : "Refresh research"}
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full bg-strong px-5 text-sm font-semibold text-strong-foreground hover:opacity-90",
              focusRing,
            )}
          >
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            <span aria-live="polite">
              {copied ? "Copied" : "Copy for a grant report"}
            </span>
          </button>
        </div>
      </div>
      {refreshError && (
        <p role="alert" className="mt-2 text-sm text-alert-foreground">
          {refreshError}
        </p>
      )}

      <section className="impact-panel-card" aria-labelledby="impact-q4">
        <h4
          id="impact-q4"
          className="mb-2 text-sm font-semibold text-muted-foreground"
        >
          {quarter ? `${quarter.label} giving` : "Quarter giving"}
        </h4>
        {quarter ? (
          <>
            <p className="text-3xl font-semibold tracking-tight">
              {usd(quarter.raised)}
              {quarter.goal != null && (
                <span className="text-xl font-normal text-muted-foreground">
                  {" "}
                  of {usd(quarter.goal)}
                </span>
              )}
            </p>
            {percent != null && (
              <div className="mt-3 flex items-center gap-3">
                <div
                  className="impact-panel-bar flex-1"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(percent, 100)}
                  aria-label="Quarter goal progress"
                >
                  <span style={{ width: `${Math.min(percent, 100)}%` }} />
                </div>
                <span className="text-lg font-semibold tabular-nums">
                  {percent}%
                </span>
              </div>
            )}
          </>
        ) : (
          <p className="text-base text-muted-foreground">
            {targetsPending
              ? "Loading…"
              : "No gifts recorded for this quarter yet."}
          </p>
        )}
      </section>

      <section className="impact-panel-card" aria-labelledby="impact-done">
        <h4 id="impact-done" className="mb-2 text-lg font-semibold">
          What we've done
        </h4>
        {list.length === 0 ? (
          <p className="text-base text-muted-foreground">{NO_FACTS}</p>
        ) : (
          <>
            <ul className="impact-panel-facts">
              {shown.map((f) => (
                <li key={f.id}>
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="impact-panel-kind">{kindLabel(f)}</span>
                    {(f.cached ||
                      contextSourceStatus[f.source] === "cached" ||
                      contextSourceStatus[f.source]?.startsWith(
                        "error: cached fallback",
                      )) && (
                      <span className="text-xs text-muted-foreground">
                        Saved research
                      </span>
                    )}
                    {formatPosted(f.posted_at) && (
                      <span className="text-sm text-muted-foreground">
                        {formatPosted(f.posted_at)}
                      </span>
                    )}
                  </div>
                  {f.title && (
                    <p className="text-base font-semibold">{f.title}</p>
                  )}
                  <p className="text-base leading-snug">{f.fact}</p>
                  <a
                    href={f.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "mt-1 inline-flex items-center gap-1 rounded-sm text-sm underline underline-offset-3",
                      focusRing,
                    )}
                  >
                    source ↗
                    <span className="sr-only">
                      {" "}
                      ({host(f.source_url)}, opens in a new tab)
                    </span>
                  </a>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {host(f.source_url)}
                  </span>
                </li>
              ))}
            </ul>
            {list.length > FACTS_SHOWN && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className={cn(
                  "mt-2 min-h-9 rounded-sm text-sm font-semibold underline underline-offset-3",
                  focusRing,
                )}
              >
                {showAll ? "Show fewer" : `Show all ${list.length}`}
              </button>
            )}
          </>
        )}
      </section>

      <section className="impact-panel-card" aria-labelledby="impact-serve">
        {!hasCommunity ? (
          <>
            <h4 id="impact-serve" className="mb-1 text-sm font-semibold">
              Who we serve
            </h4>
            <p className="text-sm text-muted-foreground">{NO_COMMUNITY}</p>
          </>
        ) : (
          <>
            <h4 id="impact-serve" className="text-sm font-semibold">
              <button
                type="button"
                aria-expanded={serveOpen}
                aria-controls="impact-serve-body"
                onClick={() => setServeOpen((v) => !v)}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1 rounded-sm",
                  focusRing,
                )}
              >
                Who we serve ({total} people)
                <ChevronRight
                  className={cn(
                    "size-4 transition-transform",
                    serveOpen && "rotate-90",
                  )}
                  aria-hidden="true"
                />
              </button>
            </h4>
            {serveOpen && (
              <div id="impact-serve-body" className="mt-3 flex flex-col gap-5">
                {zip.length > 0 && <Bars title="Zip" buckets={zip} />}
                {programs.length > 0 && (
                  <div>
                    <Bars title="Programs" buckets={programs} />
                    {programs.reduce((n, b) => n + b.count, 0) !== total && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        People can be in more than one program, so these add up
                        to more than {total}.
                      </p>
                    )}
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  Self-reported by people in the Community tab · {total} people
                </p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export const ImpactPanel = () => {
  const targets = useTargets();
  const context = useOrgContext();
  const profile = useOrgProfile();
  const status = useContextStatus();
  const refresh = useRefreshContext();
  const community = useCommunityStats();
  const [copied, setCopied] = useState(false);
  const quarter = targets.data?.quarter;
  const facts = (context.data?.facts ?? []) as ImpactFact[];

  const copy = async () => {
    const text = grantSummary({ quarter, facts, stats: community.data });
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  };

  return (
    <ImpactView
      quarter={quarter}
      targetsPending={targets.isPending}
      facts={facts}
      stats={community.data}
      contextCached={context.data?.cached}
      contextSourceStatus={profile.data?.source_status}
      canRefresh={DATA_MODE === "local"}
      refreshing={refresh.isPending}
      refreshError={refresh.error?.message ?? null}
      onRefresh={() => refresh.mutate()}
      refreshedAt={
        status.data?.last_refreshed_at ?? context.data?.profile?.updated_at
      }
      onCopy={copy}
      copied={copied}
    />
  );
};

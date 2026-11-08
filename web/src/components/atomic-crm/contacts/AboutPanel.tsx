import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DonorDetail, SummarySource } from "../providers/local/types";
import { tileClass } from "./donorCrmUi";
import { formatDay } from "./donorFormat";

const SOURCE_LABEL: Record<SummarySource["kind"], string> = {
  chat: "chat",
  call_note: "call note",
  note: "note",
  gift: "gift",
};

const shortDay = (iso: string) => {
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/** "From: chat Nov 8, call note Nov 3": where the paragraph's facts came from, newest first. */
export const sourcesLine = (sources: SummarySource[], max = 4) =>
  sources
    .slice(0, max)
    .map((s) => `${SOURCE_LABEL[s.kind] ?? s.kind} ${shortDay(s.at)}`)
    .join(", ");

/** "About <first name>": the agent's running summary (service/donor_summary.py), top of the profile Overview. */
export const AboutPanel = ({
  donor,
  className,
}: {
  donor: DonorDetail;
  className?: string;
}) => {
  const first = donor.full_name.split(" ")[0];
  return (
    <section
      aria-label={`About ${first}`}
      className={cn(tileClass, "space-y-2 p-4 sm:p-5", className)}
    >
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em]">
          About {first}
        </h3>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Sparkles className="size-3" aria-hidden />
          written by the agent
          {donor.summary_updated_at &&
            ` · updated ${formatDay(donor.summary_updated_at)}`}
        </span>
      </header>
      {donor.summary ? (
        <>
          <p className="text-sm leading-relaxed">{donor.summary}</p>
          {donor.summary_sources.length > 0 && (
            <p className="text-xs text-muted-foreground">
              From: {sourcesLine(donor.summary_sources)}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No notes yet. Tell the agent about a conversation, or save a call
          note.
        </p>
      )}
    </section>
  );
};

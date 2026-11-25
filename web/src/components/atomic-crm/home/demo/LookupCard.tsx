import { Check, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { LookupData } from "./scenarios";

const Section = ({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) => (
  <div className="mt-2">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {title}
      {note && <span className="ml-1.5 font-normal normal-case tracking-normal">({note})</span>}
    </p>
    {children}
  </div>
);

/** "Look up <person>": what the CRM already knows, what the web adds, and the next step. */
export const LookupCard = ({
  lookup,
  saved,
  onSave,
  onOpenProfile,
}: {
  lookup: LookupData;
  saved: boolean;
  onSave: () => void;
  onOpenProfile: () => void;
}) => (
  <li data-testid="lookup-card" className="rounded-xl border border-border bg-card px-3 py-2 text-[13px]">
    <p className="font-semibold">Lookup: {lookup.name}</p>
    {lookup.org && <p className="text-muted-foreground">{lookup.org}</p>}
    <Section title="From your CRM">
      <ul className="list-disc pl-4">
        {lookup.crm.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Section>
    <Section title="Found on the web" note="illustrative: no search ran in this preview">
      <ul className="list-disc pl-4">
        {lookup.web.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Section>
    <Section title="Suggested next step">
      <p>{lookup.next_step}</p>
    </Section>
    <div className="mt-2 flex flex-wrap justify-end gap-2">
      <Button size="sm" variant="outline" className="rounded-full" onClick={onOpenProfile}>
        <UserRound aria-hidden />
        Open profile
      </Button>
      <Button size="sm" className="rounded-full" disabled={saved} onClick={onSave}>
        <Check aria-hidden />
        {saved ? "Saved" : "Save to profile"}
      </Button>
    </div>
  </li>
);

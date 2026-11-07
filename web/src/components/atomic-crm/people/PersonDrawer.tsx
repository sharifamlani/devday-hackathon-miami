import { useEffect, useState } from "react";
import { Dog } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { OutreachPanel } from "../contacts/OutreachPanel";
import { ScoreWhyPanel } from "../contacts/ScoreWhyPanel";
import { TAB_LABELS, type Person } from "../providers/local/crmTypes";
import { useDonor, useOrgProfile } from "../providers/local/hooks";
import { useChatHost } from "../shell/chatHostContext";
import { SocialPostingSoon } from "../shell/SocialPostingSoon";
import { communityCheckIn, giverBrief, neighborFollowUp } from "./templates";

/** Right-hand drawer for one person; what it shows depends on the tab. */
export const PersonDrawer = ({ person, onClose }: { person: Person | null; onClose: () => void }) => {
  const { context, setContext } = useChatHost();
  // The chat panel knows which person is open.
  useEffect(() => {
    if (person) setContext({ screen: person.tab, person_id: person.id });
  }, [person, setContext]);
  return (
    <Sheet
      open={person != null}
      onOpenChange={(open) => {
        if (!open) {
          setContext({ screen: context.screen });
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl">
        {person && (
          <>
            <SheetHeader>
              <SheetTitle>{person.name}</SheetTitle>
              <SheetDescription>
                {TAB_LABELS[person.tab]}
                {person.org_name && person.org_name !== person.name ? ` · ${person.org_name}` : ""}
                {person.city ? ` · ${person.city}` : ""}
                {person.is_sample ? " · Sample history" : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              {person.needs_review && (
                <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
                  Needs your call: {person.review_reason ?? "the import wasn’t sure which tab this person belongs in."}
                </p>
              )}
              {person.tab === "giver" && <GiverDetail person={person} />}
              {person.tab === "community" && <CommunityDetail person={person} />}
              {person.tab === "neighbor" && <NeighborDetail person={person} />}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

const useOrgName = () => useOrgProfile().data?.name ?? "The Miami Foundation";

const GiverDetail = ({ person }: { person: Person }) => {
  const donor = useDonor(person.id);
  const [checked, setChecked] = useState<number[]>([]);
  const [brief, setBrief] = useState<string | null>(null);
  if (donor.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (donor.error) return <p className="text-sm text-muted-foreground">{donor.error.message}</p>;
  const d = donor.data;
  const toggle = (id: number) =>
    setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <>
      <ScoreWhyPanel donor={d} />
      <section aria-labelledby="research-title" className="space-y-2">
        <h3 id="research-title" className="text-xs font-bold uppercase tracking-wider">Research</h3>
        {d.research.length ? (
          <ul className="space-y-1.5 text-sm">
            {d.research.map((fact) => (
              <li key={fact.id}>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={checked.includes(fact.id)} onChange={() => toggle(fact.id)} />
                  <span>
                    {fact.fact}{" "}
                    <a href={fact.source_url} target="_blank" rel="noreferrer" className="text-primary underline">[src]</a>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No research yet for this giver.</p>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setBrief(giverBrief(d, d.research.filter((f) => checked.includes(f.id))))}
        >
          Build brief
        </Button>
        {brief && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Brief (stub): assembled from the facts you checked, not written by the AI.
            </p>
            <Textarea readOnly value={brief} className="min-h-40 text-sm" aria-label="Brief" />
          </div>
        )}
      </section>
      <OutreachPanel donor={d} />
      <SocialPostingSoon />
    </>
  );
};

const TemplateDraft = ({ title, initial, note }: { title: string; initial: string; note: string }) => {
  const [text, setText] = useState(initial);
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-bold uppercase tracking-wider">{title}</h3>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-40 text-sm" aria-label={title} />
      <p className="text-xs text-muted-foreground">{note}</p>
    </section>
  );
};

const CommunityDetail = ({ person }: { person: Person }) => {
  const org = useOrgName();
  return (
    <>
      <section aria-labelledby="demo-title" className="space-y-2">
        <h3 id="demo-title" className="text-xs font-bold uppercase tracking-wider">What the nonprofit recorded</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          {person.demographics.map((d) => (
            <div key={d.label}>
              <dt className="text-muted-foreground">{d.label}</dt>
              <dd className={d.value === "not recorded" ? "italic text-muted-foreground" : ""}>{d.value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-muted-foreground">Has a dog</dt>
            <dd className={person.has_dog == null ? "italic text-muted-foreground" : ""}>
              {person.has_dog == null ? "not recorded" : person.has_dog ? <><Dog className="inline size-3.5" aria-hidden /> yes</> : "no"}
            </dd>
          </div>
        </dl>
        {person.tags.length > 0 && <p className="text-sm">Interests: {person.tags.join(", ")}</p>}
      </section>
      <TemplateDraft
        title="Check-in draft"
        initial={communityCheckIn(person, org)}
        note="A template, not written by the AI. Never a donation ask. Nothing is sent from here: sending goes through the assistant and needs approval."
      />
    </>
  );
};

const NeighborDetail = ({ person }: { person: Person }) => {
  const org = useOrgName();
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <div><dt className="text-muted-foreground">Email</dt><dd>{person.email ?? "not recorded"}</dd></div>
        <div><dt className="text-muted-foreground">Interests</dt><dd>{person.tags.join(", ") || "not recorded"}</dd></div>
      </dl>
      <TemplateDraft
        title="Follow-up draft"
        initial={neighborFollowUp(person, org)}
        note="A template, not written by the AI. Nothing is sent from here: sending goes through the assistant and needs approval."
      />
    </>
  );
};

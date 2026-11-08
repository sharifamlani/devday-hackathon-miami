import { useId, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useCreateCampaign, useDonors } from "../providers/local/hooks";
import type {
  CampaignChannel,
  CampaignIntent,
} from "../providers/local/campaignTypes";
import type { DonorSummary } from "../providers/local/types";
import {
  CHANNELS,
  INTENTS,
  intentLabel,
  isIntent,
  pillButton,
} from "./campaignFormat";
import { LinkPill, PageShell, SimulatedNote } from "./campaignUi";

const MAX_DONORS = 25;

/** Same rule as the service: star, big tier or organization → one-by-one approval. */
const needsIndividualApproval = (d: DonorSummary) =>
  d.is_star || d.tier === "big" || d.donor_type === "organization";

const idsFrom = (raw: string | null) => [
  ...new Set(
    (raw ?? "")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  ),
];

/**
 * /campaigns/new?donors=1,2,3&intent=thank_you|re_engage|check_in
 * Ask (#36) and Targets (#37) link here with their donor list.
 */
export const CampaignNew = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: donors, isPending, error } = useDonors();
  const create = useCreateCampaign();
  const intentParam = params.get("intent");
  const [selected, setSelected] = useState<number[]>(() =>
    idsFrom(params.get("donors")),
  );
  const [intent, setIntent] = useState<CampaignIntent>(
    isIntent(intentParam) ? intentParam : "thank_you",
  );
  const [channel, setChannel] = useState<CampaignChannel>("email");
  const [name, setName] = useState("");
  const nameId = useId();
  const addId = useId();

  const byId = new Map((donors ?? []).map((d) => [d.id, d]));
  const chosen = selected
    .map((id) => byId.get(id))
    .filter((d): d is DonorSummary => !!d);
  const unknown = donors ? selected.filter((id) => !byId.has(id)) : [];
  const available = (donors ?? []).filter((d) => !selected.includes(d.id));
  const individual = chosen.filter(needsIndividualApproval).length;
  const defaultName = `${intentLabel(intent)} · ${channel === "email" ? "Email" : "Text"} · ${chosen.length} donor${chosen.length === 1 ? "" : "s"}`;
  const tooMany = chosen.length > MAX_DONORS;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!chosen.length || tooMany) return;
    try {
      const campaign = await create.mutateAsync({
        donor_ids: chosen.map((d) => d.id),
        intent,
        channel,
        name: name.trim() || null,
      });
      navigate(`/campaigns/${campaign.id}`);
    } catch {
      // create.error is shown below
    }
  };

  return (
    <PageShell
      eyebrow="NEW CAMPAIGN"
      title="One personal message per donor"
      caption="The outreach agent drafts each message from that donor's record and the Foundation's own facts. You review every draft before anything goes out."
      actions={<LinkPill to="/campaigns">All campaigns</LinkPill>}
    >
      <form onSubmit={submit} className="space-y-5">
        <section
          aria-labelledby="donors-heading"
          className="space-y-3 rounded-[22px] bg-card p-5"
        >
          <h2 id="donors-heading" className="text-sm font-semibold">
            Donors ({chosen.length})
          </h2>
          {isPending ? (
            <Skeleton className="h-11 w-full rounded-full" />
          ) : error ? (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          ) : (
            <>
              {chosen.length ? (
                <ul className="flex flex-wrap gap-2" aria-label="Chosen donors">
                  {chosen.map((d) => (
                    <li
                      key={d.id}
                      className="flex min-h-11 items-center gap-2 rounded-full bg-surface pl-4 pr-1 text-sm"
                    >
                      <span className="font-medium">
                        {d.is_star && <span aria-label="Star donor">★ </span>}
                        {d.full_name}
                      </span>
                      {needsIndividualApproval(d) && (
                        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-soft-foreground">
                          approve one by one
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setSelected((ids) => ids.filter((id) => id !== d.id))
                        }
                        aria-label={`Remove ${d.full_name}`}
                        className="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No donors yet. Add them below, or start from the Ask or
                  Targets screens.
                </p>
              )}
              {unknown.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Not found and left out: donor {unknown.join(", ")}.
                </p>
              )}
              <div className="space-y-1.5">
                <label
                  htmlFor={addId}
                  className="text-xs font-medium text-muted-foreground"
                >
                  Add a donor
                </label>
                <select
                  id={addId}
                  value=""
                  onChange={(event) => {
                    const id = Number(event.target.value);
                    if (id) setSelected((ids) => [...ids, id]);
                  }}
                  className="block min-h-11 w-full rounded-full border border-border bg-surface px-4 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <option value="">Choose a donor…</option>
                  {available.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name} · score {d.score}
                    </option>
                  ))}
                </select>
              </div>
              {individual > 0 && (
                <p className="text-xs text-muted-foreground">
                  {individual} of these are star, big or organization donors: a
                  person approves each of their messages individually. The rest
                  can be approved together.
                </p>
              )}
              {tooMany && (
                <p role="alert" className="text-sm text-destructive">
                  A campaign holds at most {MAX_DONORS} donors.
                </p>
              )}
            </>
          )}
        </section>

        <ChoiceGroup
          legend="What is this campaign for?"
          name="intent"
          options={INTENTS}
          value={intent}
          onChange={(v) => setIntent(v as CampaignIntent)}
        />
        <ChoiceGroup
          legend="Channel"
          name="channel"
          options={CHANNELS}
          value={channel}
          onChange={(v) => setChannel(v as CampaignChannel)}
        />

        <section className="space-y-1.5 rounded-[22px] bg-card p-5">
          <label htmlFor={nameId} className="text-sm font-semibold">
            Campaign name{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <Input
            id={nameId}
            value={name}
            maxLength={120}
            placeholder={defaultName}
            onChange={(event) => setName(event.target.value)}
            className="min-h-11 rounded-full border-border bg-surface px-4"
          />
        </section>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <SimulatedNote className="max-w-md" />
          <Button
            type="submit"
            className={cn(
              pillButton,
              "bg-brand text-brand-foreground hover:bg-brand/85",
            )}
            disabled={!chosen.length || tooMany || create.isPending}
          >
            {create.isPending ? <Spinner /> : <Sparkles />}
            {create.isPending
              ? "Drafting…"
              : chosen.length
                ? `Draft ${chosen.length} message${chosen.length === 1 ? "" : "s"}`
                : "Draft messages"}
          </Button>
        </div>
        {create.isPending && (
          <p role="status" className="text-right text-xs text-muted-foreground">
            Drafting one message per donor. With the live agent this takes a few
            seconds each.
          </p>
        )}
        {create.isError && (
          <p role="alert" className="text-sm text-destructive">
            {create.error.message}
          </p>
        )}
      </form>
    </PageShell>
  );
};

const ChoiceGroup = ({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: { id: string; label: string; hint: string }[];
  value: string;
  onChange: (value: string) => void;
}) => (
  <fieldset className="space-y-3 rounded-[22px] bg-card p-5">
    <legend className="float-left mb-3 w-full text-sm font-semibold">
      {legend}
    </legend>
    <div className="clear-left grid gap-2 sm:grid-cols-3">
      {options.map((option) => (
        <label
          key={option.id}
          className={cn(
            "flex min-h-11 cursor-pointer flex-col justify-center rounded-[18px] border border-border px-4 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
            value === option.id
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-surface hover:bg-accent",
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.id}
            checked={value === option.id}
            onChange={() => onChange(option.id)}
            className="sr-only"
          />
          <span className="font-semibold">{option.label}</span>
          <span
            className={cn(
              "text-xs",
              value === option.id
                ? "text-primary-foreground"
                : "text-muted-foreground",
            )}
          >
            {option.hint}
          </span>
        </label>
      ))}
    </div>
  </fieldset>
);

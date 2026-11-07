import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOrgProfile, useRunContext } from "../providers/local/hooks";
import type { ContextRunSource } from "../providers/local/types";
import { ContextStatusLine } from "../shell/ContextStatusLine";
import { SocialPostingSoon } from "../shell/SocialPostingSoon";

const FIELDS = [
  { key: "website", label: "Website", placeholder: "https://www.yourorg.org", required: true },
  { key: "x_url", label: "X", placeholder: "https://x.com/yourorg", required: false },
  { key: "linkedin_url", label: "LinkedIn", placeholder: "https://www.linkedin.com/company/yourorg", required: false },
  { key: "instagram_url", label: "Instagram", placeholder: "https://www.instagram.com/yourorg", required: false },
] as const;
type Key = (typeof FIELDS)[number]["key"];

const STATE_STYLE: Record<ContextRunSource["state"], string> = {
  done: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  blocked: "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100",
  failed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
  not_provided: "bg-muted text-muted-foreground",
  saved_not_connected: "bg-muted text-muted-foreground",
};

/** Step 2: website (required) + socials (saved, not connected); reads the website. */
export const OnlineStep = () => {
  const profile = useOrgProfile();
  const run = useRunContext();
  const [values, setValues] = useState<Record<Key, string>>({
    website: "",
    x_url: "",
    linkedin_url: "",
    instagram_url: "",
  });

  // Prefill from the saved profile once.
  useEffect(() => {
    const p = profile.data;
    if (!p) return;
    setValues((v) => ({
      website: v.website || p.website || "",
      x_url: v.x_url || p.socials.find((s) => s.platform === "x")?.url || "",
      linkedin_url: v.linkedin_url || p.socials.find((s) => s.platform === "linkedin")?.url || "",
      instagram_url: v.instagram_url || p.socials.find((s) => s.platform === "instagram")?.url || "",
    }));
  }, [profile.data]);

  const result = run.data;

  return (
    <section aria-labelledby="online-title" className="space-y-5">
      <div>
        <h2 id="online-title" className="text-xl font-semibold">2. Where you are online</h2>
        <p className="text-sm text-muted-foreground">
          The agent reads your website for dated, sourced facts your outreach can lead with. Social links are saved for
          later; they aren’t read yet.
        </p>
      </div>

      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          run.mutate(values);
        }}
      >
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`online-${f.key}`}>
              {f.label}
              {f.required ? " (required)" : ""}
            </Label>
            <Input
              id={`online-${f.key}`}
              type="url"
              required={f.required}
              placeholder={f.placeholder}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!values.website.trim() || run.isPending}>
            {run.isPending ? "Reading your website…" : "Save and read my website"}
          </Button>
          {!values.website.trim() && <span className="text-sm text-muted-foreground">Add your website to continue</span>}
        </div>
      </form>

      {run.isError && <p role="alert" className="text-sm text-destructive">{run.error.message}</p>}

      {result && (
        <div className="space-y-3 rounded-[22px] bg-card p-4">
          <h3 className="font-semibold">
            {result.status === "done" ? "Done" : "Couldn’t finish"}
            {result.served_from === "fallback" && (
              <span className="ml-2 text-sm font-normal text-muted-foreground" title={result.detail ?? undefined}>
                Showing saved context
              </span>
            )}
          </h3>
          <ul className="flex flex-wrap gap-2" aria-label="Sources">
            {result.sources.map((s) => (
              <li
                key={s.source}
                className={`rounded-full px-3 py-1 text-sm ${STATE_STYLE[s.state]}`}
                title={s.detail ?? undefined}
              >
                {s.label}: {s.state === "saved_not_connected" ? "Saved, not connected" : s.status_text}
                {s.state === "done" ? ` · ${s.fact_count} facts` : ""}
              </li>
            ))}
          </ul>
          {result.facts.length > 0 && (
            <ul className="space-y-1 text-sm">
              {result.facts.slice(0, 5).map((f, i) => (
                <li key={`${f.source_url}-${i}`}>
                  {f.posted_at && <span className="text-muted-foreground">{f.posted_at} · </span>}
                  {f.fact}{" "}
                  <a href={f.source_url} target="_blank" rel="noreferrer" className="text-primary underline">[src]</a>
                </li>
              ))}
            </ul>
          )}
          <Button nativeButton={false} render={<a href="#/people" />}>Go to People</Button>
        </div>
      )}

      <div className="space-y-2 border-t pt-4">
        <ContextStatusLine />
        <SocialPostingSoon />
      </div>
    </section>
  );
};

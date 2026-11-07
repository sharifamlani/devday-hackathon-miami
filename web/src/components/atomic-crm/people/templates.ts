import type { Person } from "../providers/local/crmTypes";
import type { DonorDetail } from "../providers/local/types";

/** Words a Community message must never contain (plan.md §17: no donation ask). */
export const ASK_WORDS = /\b(give|giving|gifts?|donat\w*|contribut\w*|support us|pledge\w*)\b|\$\s?\d/i;

const firstName = (person: Person) => person.name.split(/\s+/)[0] || person.name;

/**
 * A plain check-in for someone the nonprofit helps: about programs and help,
 * never money. A template (not AI-written), shown for a person to edit; it is
 * not sent from here.
 */
export const communityCheckIn = (person: Person, orgName: string): string => {
  const programs = person.demographics.find((d) => d.label === "Programs")?.value;
  const program = programs && programs !== "not recorded" ? programs.split(", ")[0] : null;
  return [
    `Hi ${firstName(person)},`,
    "",
    `It’s ${orgName} checking in. ${
      program ? `How is ${program} going for you?` : "How are things going?"
    }`,
    "If there’s anything you need, or a program you’d like to hear about, just reply to this message.",
    "",
    `Warmly,\n${orgName}`,
  ].join("\n");
};

/** A follow-up for a Neighbor (met, not yet a giver or in a program). */
export const neighborFollowUp = (person: Person, orgName: string): string =>
  [
    `Hi ${firstName(person)},`,
    "",
    `It was good to meet you. ${orgName} has a few things coming up${
      person.tags.length ? ` you might like, given your interest in ${person.tags[0]}` : ""
    }. Would you like us to keep you posted?`,
    "",
    `Best,\n${orgName}`,
  ].join("\n");

/**
 * Build brief (stub): assembled only from the giver's why and the research
 * facts a person checked. Not written by the AI; the real brief agent is
 * build_brief in the chat panel.
 */
export const giverBrief = (
  donor: DonorDetail,
  checked: { fact: string; source_url: string }[],
): string =>
  [
    `Brief: ${donor.full_name}${donor.is_star ? " ★" : ""}`,
    "",
    `Why now: ${donor.why}`,
    "",
    checked.length ? "Research you checked:" : "No research checked yet.",
    ...checked.map((f) => `• ${f.fact} (${f.source_url})`),
    "",
    "Open with what the Foundation did; ask for a conversation, not a figure.",
  ].join("\n");

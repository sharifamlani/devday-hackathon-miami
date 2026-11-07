import type { ContextRunInput } from "./types";

export const WEBSITE_REQUIRED = "Add your website to continue";

/**
 * Onboarding screen 2: the website is required (lead decision, Sat Nov 7).
 * A run without one fails, and a failed run saves nothing, so any social
 * URLs typed alongside would be silently dropped. Reject before the request.
 */
export const requireWebsite = (input: ContextRunInput): string => {
  const website = input.website?.trim();
  if (!website) throw new Error(WEBSITE_REQUIRED);
  return website;
};

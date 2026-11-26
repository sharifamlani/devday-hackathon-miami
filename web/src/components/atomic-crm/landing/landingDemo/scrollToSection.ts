/**
 * Scrolls to a landing section without touching location.hash: the hash is the app's router, so
 * `href="#problem"` would open the CRM instead of scrolling (docs/plans/landing-story.md §2).
 */
export const scrollToSection = (id: string, focusId?: string) => {
  const target = document.getElementById(id);
  if (!target) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "start",
  });
  if (focusId)
    window.setTimeout(
      () => document.getElementById(focusId)?.focus({ preventScroll: true }),
      500,
    );
};

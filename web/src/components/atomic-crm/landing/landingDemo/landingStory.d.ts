import type { DemoData } from "./deriveDemoData";

/**
 * Starts the landing story's behavior inside `root` (the markup from landingStory.html). Without data the
 * problem toggle and the player still run, and the demo window offers the sample workspace instead.
 * Returns the cleanup that stops every timer and observer.
 */
export function mountLandingStory(
  root: HTMLElement,
  data: DemoData | null,
): () => void;

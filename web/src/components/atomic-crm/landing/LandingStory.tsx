import { useEffect, useRef } from "react";

import { SNAPSHOT_URL } from "../providers/local/config";
import { deriveDemoData, type DemoData } from "./landingDemo/deriveDemoData";
import { mountLandingStory } from "./landingDemo/landingStory";
import { scrollToSection } from "./landingDemo/scrollToSection";
import storyHtml from "./landingStory.html?raw";

/**
 * Sections 2–5 of the landing page: the problem, the working Gatherly demo, how it works, the closing call to
 * action. The demo always plays the read-only sample snapshot (never the live database) and keeps every change
 * in memory, whichever data mode the app runs in.
 */
export const LandingStory = () => {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    const start = (data: DemoData | null) => {
      if (!cancelled) stop = mountLandingStory(el, data);
    };
    fetch(SNAPSHOT_URL)
      .then((res) =>
        res.ok
          ? res.json()
          : Promise.reject(new Error(`snapshot ${res.status}`)),
      )
      .then((snap) => start(deriveDemoData(snap)))
      .catch(() => start(null));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return (
    <div
      ref={root}
      onClick={(event) => {
        const go = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-go]",
        );
        if (!go) return;
        event.preventDefault();
        scrollToSection(go.dataset.go ?? "", go.dataset.focus);
      }}
      dangerouslySetInnerHTML={{ __html: storyHtml }}
    />
  );
};

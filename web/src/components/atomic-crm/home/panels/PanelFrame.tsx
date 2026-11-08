import { startTransition, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import type { WorkspaceView } from "../workspaceView";

export const PANEL_TITLES: Record<WorkspaceView, string> = {
  calendar: "Calendar",
  tasks: "Tasks",
  crm: "Donors",
  impact: "Impact",
};

/** The shared zoom frame: toolbar (heading, back, close) around a named content layer. */
export const PanelFrame = ({
  view,
  onClose,
  children,
}: {
  view: WorkspaceView;
  onClose: () => void;
  children: ReactNode;
}) => {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section
      className="desk-main-panel"
      aria-label={`${PANEL_TITLES[view]} workspace`}
      data-workspace={view}
    >
      <div className="desk-panel-toolbar">
        <button type="button" className="desk-panel-back" onClick={onClose}>
          <ArrowLeft size={16} /> Back to chat
        </button>
        <h2 ref={heading} tabIndex={-1}>
          {PANEL_TITLES[view]}
        </h2>
        <button
          type="button"
          className="desk-panel-close"
          aria-label="Close workspace panel"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="desk-panel-body">
        <DeferredBody key={view}>{children}</DeferredBody>
      </div>
    </section>
  );
};

/**
 * Mounts heavy panel content as an interruptible React transition after the frame has been
 * painted, so the zoom never waits on the list or calendar rendering.
 */
const DeferredBody = ({ children }: { children: ReactNode }) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => startTransition(() => setReady(true)));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);
  return ready ? <>{children}</> : null;
};

export const PlaceholderPanel = ({ title }: { title: string }) => (
  <div className="desk-panel-placeholder">
    <p>{title} panel — coming in the next PR</p>
  </div>
);

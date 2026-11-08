import {
  getRecording,
  setRecording,
  subscribeRecording,
} from "../voice/recordingState";
import { shellState, voiceButtonAction } from "./shellState";

describe("shellState", () => {
  it("shows no pane when closed, whatever else is set", () => {
    for (const dockable of [true, false])
      for (const expanded of [true, false])
        expect(shellState({ open: false, dockable, expanded })).toEqual({
          docked: false,
          overlay: false,
          workspaceHidden: false,
        });
  });

  it("docks beside the workspace on wide screens", () => {
    expect(shellState({ open: true, dockable: true, expanded: false })).toEqual(
      { docked: true, overlay: false, workspaceHidden: false },
    );
  });

  it("takes the workspace's place when expanded on wide screens", () => {
    expect(shellState({ open: true, dockable: true, expanded: true })).toEqual({
      docked: true,
      overlay: false,
      workspaceHidden: true,
    });
  });

  it("overlays on narrow screens and never hides the workspace", () => {
    for (const expanded of [true, false])
      expect(shellState({ open: true, dockable: false, expanded })).toEqual({
        docked: false,
        overlay: true,
        workspaceHidden: false,
      });
  });
});

describe("voiceButtonAction", () => {
  it("opens when closed, in either mode", () => {
    expect(voiceButtonAction(false, "ask")).toBe("open");
    expect(voiceButtonAction(false, "voice")).toBe("open");
  });

  it("switches from Ask to the transcript instead of closing", () => {
    expect(voiceButtonAction(true, "ask")).toBe("open");
  });

  it("closes when the transcript is already showing", () => {
    expect(voiceButtonAction(true, "voice")).toBe("close");
  });
});

describe("recordingState", () => {
  afterEach(() => setRecording(false));

  it("starts off and follows setRecording", () => {
    expect(getRecording()).toBe(false);
    setRecording(true);
    expect(getRecording()).toBe(true);
    setRecording(false);
    expect(getRecording()).toBe(false);
  });

  it("notifies subscribers only on a change, until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecording(listener);
    setRecording(true);
    setRecording(true);
    expect(listener).toHaveBeenCalledTimes(1);
    setRecording(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setRecording(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import {
  MOTION_STORAGE_KEY,
  motionMs,
  parseTimeMs,
  prefersReducedMotion,
  readMotionPreference,
  setMotionPreference,
} from "./motion";

const win = (reduced: boolean) =>
  ({ matchMedia: () => ({ matches: reduced }) }) as unknown as Window;

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.motion;
  document.documentElement.removeAttribute("style");
});

describe("motion preference", () => {
  it("defaults to following the system", () => {
    expect(readMotionPreference()).toBe("system");
    expect(prefersReducedMotion(win(true))).toBe(true);
    expect(prefersReducedMotion(win(false))).toBe(false);
  });

  it("Reduce motion wins over the system; Full motion keeps motion on", () => {
    setMotionPreference("reduce");
    expect(document.documentElement.dataset.motion).toBe("reduce");
    expect(prefersReducedMotion(win(false))).toBe(true);
    setMotionPreference("full");
    expect(prefersReducedMotion(win(true))).toBe(false);
  });

  it("is saved and read back; junk falls back to system", () => {
    setMotionPreference("reduce");
    expect(window.localStorage.getItem(MOTION_STORAGE_KEY)).toBe("reduce");
    expect(readMotionPreference()).toBe("reduce");
    window.localStorage.setItem(MOTION_STORAGE_KEY, "wild");
    expect(readMotionPreference()).toBe("system");
  });
});

describe("motion speeds", () => {
  it("parses ms and s", () => {
    expect(parseTimeMs("320ms")).toBe(320);
    expect(parseTimeMs(" 0.2s")).toBe(200);
    expect(parseTimeMs("fast")).toBeNaN();
  });

  it("reads the default speeds (120, 200, 320ms)", () => {
    expect([motionMs("fast"), motionMs("base"), motionMs("slow")]).toEqual([120, 200, 320]);
  });

  it("reads the variables and multiplies by --motion-scale (0 = no motion)", () => {
    const root = document.documentElement;
    root.style.setProperty("--duration-base", "250ms");
    root.style.setProperty("--motion-scale", "2");
    expect(motionMs("base")).toBe(500);
    root.style.setProperty("--motion-scale", "0");
    expect(motionMs("base")).toBe(0);
  });
});

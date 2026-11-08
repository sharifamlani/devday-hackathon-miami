import { describe, expect, it, vi } from "vitest";

import { MIC_ERROR_MESSAGES, micErrorFor, openMicLevel } from "./micLevel";

const fakeStream = () => {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return {
    tracks,
    stream: { getTracks: () => tracks } as unknown as MediaStream,
  };
};

const fakeAudio = (level: number) => {
  const disconnect = vi.fn();
  const close = vi.fn(() => Promise.resolve());
  const context = {
    createAnalyser: () => ({
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 128,
      getByteFrequencyData: (bins: Uint8Array) => bins.fill(level),
    }),
    createMediaStreamSource: () => ({ connect: vi.fn(), disconnect }),
    close,
  };
  return { context, disconnect, close };
};

describe("micErrorFor", () => {
  it("maps getUserMedia failures to plain messages", () => {
    const err = (name: string) => micErrorFor({ name });
    expect(err("NotAllowedError").code).toBe("denied");
    expect(err("NotAllowedError").message).toMatch(/site settings/);
    expect(err("SecurityError").code).toBe("insecure");
    expect(err("NotFoundError").code).toBe("no-device");
    expect(err("OverconstrainedError").code).toBe("no-device");
    expect(err("NotReadableError").code).toBe("in-use");
    expect(err("Weird").code).toBe("other");
    expect(micErrorFor(undefined).code).toBe("other");
  });
});

describe("openMicLevel", () => {
  it("refuses on an insecure page without asking", async () => {
    const getUserMedia = vi.fn();
    const error = await openMicLevel({
      isSecureContext: false,
      getUserMedia,
    }).catch((e: unknown) => e);
    expect(micErrorFor(error)).toEqual({
      code: "insecure",
      message: MIC_ERROR_MESSAGES.insecure,
    });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("passes a denied prompt through", async () => {
    const error = await openMicLevel({
      isSecureContext: true,
      getUserMedia: () =>
        Promise.reject(
          Object.assign(new Error("no"), { name: "NotAllowedError" }),
        ),
    }).catch((e: unknown) => e);
    expect(micErrorFor(error).code).toBe("denied");
  });

  it("asks for audio only and reads levels from the analyser", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    const { context } = fakeAudio(255);
    const mic = await openMicLevel({
      isSecureContext: true,
      getUserMedia,
      createAudioContext: () => context,
    });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ echoCancellation: true }),
    });
    const bands = mic.bands(8);
    expect(bands).toHaveLength(8);
    bands.forEach((b) => expect(b).toBeCloseTo(1));
  });

  it("stops every track and closes audio on close, once", async () => {
    const { stream, tracks } = fakeStream();
    const { context, close, disconnect } = fakeAudio(100);
    const mic = await openMicLevel({
      isSecureContext: true,
      getUserMedia: () => Promise.resolve(stream),
      createAudioContext: () => context,
    });
    mic.close();
    mic.close();
    tracks.forEach((t) => expect(t.stop).toHaveBeenCalledTimes(1));
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(mic.bands(4)).toEqual([0, 0, 0, 0]);
  });

  it("still works without Web Audio (levels stay at zero)", async () => {
    const { stream } = fakeStream();
    const mic = await openMicLevel({
      isSecureContext: true,
      getUserMedia: () => Promise.resolve(stream),
      createAudioContext: () => null,
    });
    expect(mic.bands(3)).toEqual([0, 0, 0]);
  });
});

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";

const uploadFiles = vi.hoisted(() => vi.fn());
vi.mock("../providers/local", () => ({
  DATA_MODE: "local",
  donorDeskMethods: {
    uploadFiles: (...args: unknown[]) => uploadFiles(...args),
  },
}));

const { useDataUpload } = await import("./useDataUpload");

const csv = () =>
  new File(["Name,Amount\nA B,5"], "nov15.csv", { type: "text/csv" });

const setup = async () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = await renderHook(() => useDataUpload(), { wrapper });
  return { invalidate, result: hook.result, act: hook.act };
};

beforeEach(() => {
  uploadFiles.mockReset();
});

describe("useDataUpload", () => {
  it("chooses files, uploads them as target auto, then refreshes every query", async () => {
    uploadFiles.mockResolvedValue({
      donors: 5,
      gifts: 5,
      duplicates: 1,
      message: null,
      raw: {},
    });
    const { result, invalidate, act } = await setup();
    expect(result.current.phase).toBe("empty");

    await act(() =>
      result.current.choose([csv(), new File(["x"], "answer_key.json")]),
    );
    expect(result.current.phase).toBe("chosen");
    expect(result.current.files.map((f) => f.name)).toEqual(["nov15.csv"]);
    expect(result.current.skipped.map((s) => s.name)).toEqual([
      "answer_key.json",
    ]);

    await act(async () => {
      await result.current.upload();
    });
    expect(uploadFiles).toHaveBeenCalledTimes(1);
    expect(uploadFiles.mock.calls[0][1]).toBe("auto");
    expect(invalidate).toHaveBeenCalledWith(); // no key: every panel
    expect(result.current.phase).toBe("results");
    expect(result.current.summary?.people).toBe(5);
    expect(result.current.summary?.duplicates).toBe(1);
  });

  it("reports a readable error, keeps the files for a retry, and does not refresh", async () => {
    uploadFiles.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { result, invalidate, act } = await setup();
    await act(() => result.current.choose([csv()]));
    await act(async () => {
      await result.current.upload();
    });
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toMatch(/couldn't reach the Gatherly service/);
    expect(result.current.files).toHaveLength(1);
    expect(invalidate).not.toHaveBeenCalled();

    await act(() => result.current.dismissError());
    expect(result.current.phase).toBe("chosen");
  });
});

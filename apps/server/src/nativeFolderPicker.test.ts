import { describe, expect, it } from "vitest";

import { pickNativeFolder } from "./nativeFolderPicker";

function commandError(
  message: string,
  details: { readonly code?: string | number; readonly stderr?: string } = {},
): Error {
  return Object.assign(new Error(message), details);
}

describe("pickNativeFolder", () => {
  it("opens the macOS folder chooser and returns the selected POSIX path", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const result = await pickNativeFolder({
      platform: "darwin",
      execFile: async (file, args) => {
        calls.push({ file, args });
        return { stdout: "/Users/test/Developer/synara\n" };
      },
    });

    expect(result).toBe("/Users/test/Developer/synara");
    expect(calls).toEqual([
      {
        file: "/usr/bin/osascript",
        args: ["-e", expect.stringContaining("choose folder")],
      },
    ]);
  });

  it("returns null when the native chooser is cancelled on macOS", async () => {
    await expect(
      pickNativeFolder({
        platform: "darwin",
        execFile: async () => {
          throw new Error("User canceled.");
        },
      }),
    ).resolves.toBeNull();
  });

  it("returns null when Zenity exits with its cancellation status", async () => {
    const calls: string[] = [];
    await expect(
      pickNativeFolder({
        platform: "linux",
        execFile: async (file) => {
          calls.push(file);
          throw commandError("zenity exited", { code: 1, stderr: "" });
        },
      }),
    ).resolves.toBeNull();
    expect(calls).toEqual(["zenity"]);
  });

  it("falls back to KDialog only when Zenity is unavailable", async () => {
    const calls: string[] = [];
    const result = await pickNativeFolder({
      platform: "linux",
      execFile: async (file) => {
        calls.push(file);
        if (file === "zenity") throw commandError("spawn zenity", { code: "ENOENT" });
        return { stdout: "/Users/test/Developer/synara\n" };
      },
    });

    expect(result).toBe("/Users/test/Developer/synara");
    expect(calls).toEqual(["zenity", "kdialog"]);
  });

  it("propagates genuine chooser failures", async () => {
    const failure = commandError("zenity failed", { code: 1, stderr: "Unable to connect to display" });
    await expect(
      pickNativeFolder({
        platform: "linux",
        execFile: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
  });
});

import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_PROTOCOL_FRAME_BYTES,
  RuntimeLock,
  createRuntimeReady,
  parseRuntimeRequest,
} from "./index";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    FS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("PortLog runtime bootstrap", () => {
  it("returns the fixed runtime capability manifest", () => {
    const ready = createRuntimeReady();

    expect(ready.protocolVersion).toBe(1);
    expect(ready.piVersion).toBe("0.81.1");
    expect(ready.capabilities).toEqual({
      tools: ["read", "write", "edit", "bash"],
      filesystemSandbox: false,
      toolApproval: false,
      shellAccess: "unrestricted-user-permissions",
    });
  });

  it("rejects malformed and oversized frames", () => {
    expect(parseRuntimeRequest("not json")).toBeNull();
    expect(parseRuntimeRequest(JSON.stringify({ jsonrpc: "1.0", method: "runtime.health" }))).toBeNull();
    expect(parseRuntimeRequest("x".repeat(MAX_PROTOCOL_FRAME_BYTES + 1))).toBeNull();
  });

  it("prevents two runtimes from owning one data directory", () => {
    const dataDir = FS.mkdtempSync(Path.join(OS.tmpdir(), "portlog-runtime-test-"));
    temporaryDirectories.push(dataDir);
    const first = new RuntimeLock();
    const second = new RuntimeLock();

    expect(first.acquire(dataDir)).toBeNull();
    expect(second.acquire(dataDir)).toBe("RUNTIME_ALREADY_ACTIVE");

    first.release();
    expect(second.acquire(dataDir)).toBeNull();
    second.release();
  });
});

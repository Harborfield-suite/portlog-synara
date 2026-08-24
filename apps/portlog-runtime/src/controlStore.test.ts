import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { PortLogRuntimeEvent } from "@synara/contracts";

import { ControlStore } from "./controlStore";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    FS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("ControlStore evidence and findings", () => {
  it("persists runtime transcript events across reopen", async () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "portlog-control-events-"));
    temporaryDirectories.push(directory);
    const first = await ControlStore.open(directory);
    const event: PortLogRuntimeEvent = {
      streamId: "stream-1",
      cursor: 1,
      sessionId: "session-1",
      turnId: "turn-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      type: "user.message",
      text: "Inspect the fixture.",
    };
    first.saveEvent(event);
    first.close();

    const second = await ControlStore.open(directory);
    expect(second.listEvents("session-1", 10)).toEqual([event]);
    second.close();
  });

  it("persists structured evidence and findings across reopen", async () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "portlog-control-store-"));
    temporaryDirectories.push(directory);
    const first = await ControlStore.open(directory);
    first.saveProject({ projectId: "project-1", root: directory });
    first.saveEvidence({
      evidenceId: "evidence-1",
      projectId: "project-1",
      artifactId: "artifact-1",
      sourceLocator: "artifact:project-1:artifact-1",
      sourceIdentity: "drawing.xml",
      sourceSha256: "hash-1",
      claim: "The pump is centrifugal.",
      claimStatus: "satisfied",
      supportStatus: "supported",
      createdByTurn: "turn-1",
    });
    first.saveFinding({
      findingId: "finding-1",
      projectId: "project-1",
      title: "Pump classification",
      summary: "The source identifies a centrifugal pump.",
      claimStatus: "satisfied",
      status: "open",
      evidenceIds: ["evidence-1"],
      createdByTurn: "turn-1",
    });
    first.close();

    const second = await ControlStore.open(directory);
    expect(second.getEvidence("project-1", "evidence-1")).toMatchObject({
      evidenceId: "evidence-1",
      sourceSha256: "hash-1",
      supportStatus: "supported",
    });
    expect(second.listFindings("project-1")).toMatchObject([
      { findingId: "finding-1", evidenceIds: ["evidence-1"], status: "open" },
    ]);
    second.close();
  });
});

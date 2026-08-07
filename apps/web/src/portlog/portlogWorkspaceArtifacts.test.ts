// FILE: portlogWorkspaceArtifacts.test.ts
import { describe, expect, it } from "vitest";
import {
  classifyPortLogWorkspaceArtifact,
  isPortLogPrimaryDrawingPath,
  portLogArtifactSortRank,
} from "./portlogWorkspaceArtifacts";

describe("classifyPortLogWorkspaceArtifact", () => {
  it("marks DEXPI XML sources", () => {
    expect(classifyPortLogWorkspaceArtifact("drawings/E06.xml")).toEqual({
      kind: "dexpi-source",
      badge: "DEXPI",
    });
    expect(isPortLogPrimaryDrawingPath("C01-shelf.XML")).toBe(true);
  });

  it("marks the PortLog project manifest", () => {
    expect(classifyPortLogWorkspaceArtifact("portlog-project.json")).toEqual({
      kind: "project-manifest",
      badge: "PortLog",
    });
  });

  it("marks prepared artifact paths", () => {
    expect(classifyPortLogWorkspaceArtifact("artifacts/topology.json").kind).toBe("prepared");
    expect(classifyPortLogWorkspaceArtifact("session.facts.json").badge).toBe("artifact");
  });

  it("leaves ordinary source files unmarked", () => {
    expect(classifyPortLogWorkspaceArtifact("apps/web/src/main.ts")).toEqual({
      kind: "ordinary",
      badge: null,
    });
  });

  it("sorts DEXPI ahead of ordinary files", () => {
    expect(portLogArtifactSortRank("E06.xml")).toBeLessThan(portLogArtifactSortRank("README.md"));
  });
});

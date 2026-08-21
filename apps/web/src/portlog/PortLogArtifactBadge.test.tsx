// FILE: PortLogArtifactBadge.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PortLogArtifactBadge } from "./PortLogArtifactBadge";

describe("PortLogArtifactBadge", () => {
  it("renders a DEXPI badge for xml drawings", () => {
    const markup = renderToStaticMarkup(<PortLogArtifactBadge pathValue="drawings/E06.xml" />);
    expect(markup).toContain('data-portlog-artifact="dexpi-source"');
    expect(markup).toContain("DEXPI");
  });

  it("renders nothing for ordinary files", () => {
    const markup = renderToStaticMarkup(<PortLogArtifactBadge pathValue="README.md" />);
    expect(markup).toBe("");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrdinaryContextLine, PortLogEvidenceChip } from "./PortLogEvidenceChip";
import {
  formatPortLogEvidenceLine,
  parsePortLogEvidenceLine,
  splitPortLogTranscriptSegments,
} from "./portlogHostBridge";

describe("portlogHostBridge", () => {
  it("formats evidence lines that parse as portlog authority", () => {
    const line = formatPortLogEvidenceLine({
      label: "E1",
      summary: "P-101 discharge check valve present",
      sourceDigest: "abc123",
    });
    expect(line).toContain("[portlog:evidence|E1|");
    const parsed = parsePortLogEvidenceLine(line);
    expect(parsed).toEqual({
      label: "E1",
      summary: "P-101 discharge check valve present digest=abc123",
      authority: "portlog",
    });
  });

  it("does not treat ordinary assistant prose as portlog evidence", () => {
    expect(parsePortLogEvidenceLine("The pump looks fine.")).toBeNull();
    expect(parsePortLogEvidenceLine("[ordinary tool output]")).toBeNull();
  });

  it("splits mixed transcript into ordinary vs portlog segments", () => {
    const text = [
      "Model prose about the line.",
      formatPortLogEvidenceLine({
        label: "E1",
        summary: "check valve on P-101 discharge",
      }),
      "More ordinary prose.",
    ].join("\n");
    const segments = splitPortLogTranscriptSegments(text);
    expect(segments).toEqual([
      { kind: "ordinary", text: "Model prose about the line." },
      {
        kind: "portlog-evidence",
        label: "E1",
        summary: "check valve on P-101 discharge",
      },
      { kind: "ordinary", text: "More ordinary prose." },
    ]);
  });
});

describe("PortLogEvidenceChip transcript chrome", () => {
  it("renders portlog authority distinctly from ordinary context", () => {
    const evidenceHtml = renderToStaticMarkup(
      <PortLogEvidenceChip label="E1" summary="grounded topology hit" />,
    );
    const ordinaryHtml = renderToStaticMarkup(
      <OrdinaryContextLine text="shell ls output" />,
    );
    expect(evidenceHtml).toContain('data-portlog-authority="portlog"');
    expect(evidenceHtml).toContain("PortLog evidence [E1]");
    expect(ordinaryHtml).toContain('data-portlog-authority="ordinary"');
    expect(ordinaryHtml).not.toContain("PortLog evidence");
  });
});

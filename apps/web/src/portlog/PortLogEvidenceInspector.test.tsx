import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PortLogEvidenceInspector } from "./PortLogEvidenceInspector";
import type { PortLogRuntimeClient } from "./portlogRuntimeClient";

const client = {} as PortLogRuntimeClient;

describe("PortLogEvidenceInspector", () => {
  it("renders an inspectable evidence and findings region", () => {
    const markup = renderToStaticMarkup(
      <PortLogEvidenceInspector client={client} projectId={null} onOpenEvidence={() => undefined} />,
    );

    expect(markup).toContain('data-testid="portlog-evidence-inspector"');
    expect(markup).toContain("Evidence &amp; findings (0 / 0)");
    expect(markup).toContain("No PortLog evidence recorded yet.");
  });
});

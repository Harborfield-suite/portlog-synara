import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PortLogDexpiWorkbench } from "./PortLogDexpiWorkbench";

describe("PortLogDexpiWorkbench", () => {
  it("starts with an import action instead of the sample graph", () => {
    const markup = renderToStaticMarkup(<PortLogDexpiWorkbench />);

    expect(markup).toContain('data-testid="portlog-dexpi-workbench"');
    expect(markup).toContain("Import process drawing");
    expect(markup).toContain("source-faithful SVG representation");
    expect(markup).not.toContain("P-101");
  });
});

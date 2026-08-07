// FILE: PortLogCraftPane.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PortLogCraftPaneChrome } from "./PortLogCraftPane";

describe("PortLogCraftPaneChrome", () => {
  it("marks the craft surface with the xyflow baseline attribute", () => {
    const markup = renderToStaticMarkup(<PortLogCraftPaneChrome />);
    expect(markup).toContain('data-portlog-craft="xyflow"');
    expect(markup).toContain('data-testid="portlog-craft-pane"');
    expect(markup).toContain("xyflow baseline");
    expect(markup).toContain('data-portlog-craft-node-count="2"');
  });
});

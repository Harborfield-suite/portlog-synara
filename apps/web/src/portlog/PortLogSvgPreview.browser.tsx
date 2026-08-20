import "../index.css";

import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const harness = vi.hoisted(() => ({
  contents: '<svg viewBox="0 0 10 10"><rect data-id="P-101" width="10" height="10" /></svg>',
}));

vi.mock("./usePortLogLocalFile", () => ({
  usePortLogLocalFile: () => ({
    contents: harness.contents,
    grantQuery: { isPending: false, error: null },
    fileQuery: { isPending: false, error: null },
  }),
}));

import { PortLogSvgPreview } from "./PortLogSvgPreview";

describe("PortLogSvgPreview", () => {
  it("loads fetched SVG markup into the drawing canvas", async () => {
    await render(<PortLogSvgPreview svgPath="artifact/rendered.svg" />);

    const svg = page.getByTestId("portlog-svg-canvas").element().querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.querySelector('[data-id="P-101"]')).not.toBeNull();
  });
});

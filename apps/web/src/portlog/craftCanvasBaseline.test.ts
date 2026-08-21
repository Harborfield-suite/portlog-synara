// FILE: craftCanvasBaseline.test.ts
import { describe, expect, it } from "vitest";
import {
  craftPaneChromeLabel,
  PORTLOG_CRAFT_ENGINE,
  SAMPLE_PORTLOG_CRAFT_GRAPH,
} from "./craftCanvasBaseline";

describe("PortLog craft canvas baseline", () => {
  it("pins xyflow as the commodity craft engine", () => {
    expect(PORTLOG_CRAFT_ENGINE).toBe("xyflow");
    expect(craftPaneChromeLabel()).toContain("xyflow");
  });

  it("ships a sample pump→valve graph with entity ids", () => {
    expect(SAMPLE_PORTLOG_CRAFT_GRAPH.nodes.map((n) => n.id)).toEqual([
      "entity:P-101",
      "entity:V-201",
    ]);
    expect(SAMPLE_PORTLOG_CRAFT_GRAPH.edges).toHaveLength(1);
    expect(SAMPLE_PORTLOG_CRAFT_GRAPH.edges[0]?.source).toBe("entity:P-101");
    expect(SAMPLE_PORTLOG_CRAFT_GRAPH.edges[0]?.target).toBe("entity:V-201");
  });
});

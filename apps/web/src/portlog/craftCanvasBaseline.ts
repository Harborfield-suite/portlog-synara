// FILE: craftCanvasBaseline.ts
// Purpose: PortLog craft-pane canvas baseline pin + sample graph for Synara spike.
// Layer: Web craft presentation helpers

/** Commodity engine for the Synara craft pane (not a full-app fork). */
export const PORTLOG_CRAFT_ENGINE = "xyflow" as const;

export type PortLogCraftEngine = typeof PORTLOG_CRAFT_ENGINE;

export type PortLogCraftNodeKind = "pump" | "valve" | "equipment";

export type PortLogCraftNode = {
  id: string;
  label: string;
  kind: PortLogCraftNodeKind;
  x: number;
  y: number;
};

export type PortLogCraftEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export type PortLogCraftGraph = {
  nodes: ReadonlyArray<PortLogCraftNode>;
  edges: ReadonlyArray<PortLogCraftEdge>;
};

/** Minimal demo topology used until PortLog host feeds real DEXPI facts. */
export const SAMPLE_PORTLOG_CRAFT_GRAPH: PortLogCraftGraph = {
  nodes: [
    { id: "entity:P-101", label: "P-101", kind: "pump", x: 80, y: 120 },
    { id: "entity:V-201", label: "V-201", kind: "valve", x: 320, y: 120 },
  ],
  edges: [{ id: "line:P-101→V-201", source: "entity:P-101", target: "entity:V-201", label: "process" }],
};

export function craftPaneChromeLabel(engine: PortLogCraftEngine = PORTLOG_CRAFT_ENGINE): string {
  return `P&ID craft · ${engine} baseline`;
}

// FILE: PortLogCraftPane.tsx
// Purpose: Synara craft-pane host for the PortLog xyflow canvas baseline.
// Layer: Web craft presentation

import { useMemo, type ReactNode } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  craftPaneChromeLabel,
  PORTLOG_CRAFT_ENGINE,
  SAMPLE_PORTLOG_CRAFT_GRAPH,
  type PortLogCraftGraph,
} from "./craftCanvasBaseline";

function toFlowNodes(graph: PortLogCraftGraph): Node[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    position: { x: node.x, y: node.y },
    data: { label: `${node.label} (${node.kind})` },
    style: {
      border: "1px solid var(--color-border, #444)",
      borderRadius: 6,
      padding: 8,
      fontSize: 12,
      background: "var(--color-background-surface, #1a1a1a)",
      color: "var(--color-foreground, #eee)",
      minWidth: 96,
    },
  }));
}

function toFlowEdges(graph: PortLogCraftGraph): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: false,
  }));
}

export function PortLogCraftPaneChrome(props: {
  children?: ReactNode;
  graph?: PortLogCraftGraph;
}) {
  const graph = props.graph ?? SAMPLE_PORTLOG_CRAFT_GRAPH;
  return (
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--color-background)]"
      data-portlog-craft={PORTLOG_CRAFT_ENGINE}
      data-testid="portlog-craft-pane"
      data-portlog-craft-node-count={String(graph.nodes.length)}
    >
      <div className="flex h-8 shrink-0 items-center border-b border-border/65 px-3 text-xs text-muted-foreground">
        {craftPaneChromeLabel()}
      </div>
      <div className="relative min-h-0 min-w-0 flex-1">{props.children}</div>
    </div>
  );
}

function PortLogCraftFlow(props: { graph: PortLogCraftGraph }) {
  const nodes = useMemo(() => toFlowNodes(props.graph), [props.graph]);
  const edges = useMemo(() => toFlowEdges(props.graph), [props.graph]);
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      proOptions={{ hideAttribution: true }}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
    >
      <Background gap={16} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}

/** Interactive craft surface: xyflow graph inside PortLog chrome. */
export function PortLogCraftPane(props: { graph?: PortLogCraftGraph } = {}) {
  const graph = props.graph ?? SAMPLE_PORTLOG_CRAFT_GRAPH;
  const canMountFlow = typeof window !== "undefined";
  return (
    <PortLogCraftPaneChrome graph={graph}>
      {canMountFlow ? (
        <ReactFlowProvider>
          <PortLogCraftFlow graph={graph} />
        </ReactFlowProvider>
      ) : null}
    </PortLogCraftPaneChrome>
  );
}

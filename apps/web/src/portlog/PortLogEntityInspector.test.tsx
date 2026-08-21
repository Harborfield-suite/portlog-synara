import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PortLogEntityInspector,
  parsePortLogDexpiEntities,
  type PortLogDexpiEntity,
} from "./PortLogEntityInspector";

const entity: PortLogDexpiEntity = {
  id: "Valve-1",
  element: "PipingComponent",
  componentClass: "GlobeValve",
  componentName: "GLOBE_VALVE_SHAPE",
  properties: { TagName: "XV-101" },
  sourceReferences: ["OperatedValveReference-1"],
  connections: [
    {
      id: "Segment-1:Valve-1:Nozzle-1",
      ownerId: "Segment-1",
      fromId: "Valve-1",
      fromNode: "1",
      toId: "Nozzle-1",
      toNode: "1",
    },
  ],
};

describe("PortLogEntityInspector", () => {
  it("parses grounded scene entities", () => {
    expect(
      parsePortLogDexpiEntities(JSON.stringify({ entities: { [entity.id]: entity } })),
    ).toEqual({
      [entity.id]: entity,
    });
    expect(parsePortLogDexpiEntities("not json")).toEqual({});
  });

  it("shows identity, properties, connections, and a deterministic query input", () => {
    const markup = renderToStaticMarkup(
      <PortLogEntityInspector entity={entity} entities={{ [entity.id]: entity }} />,
    );

    expect(markup).toContain('data-testid="portlog-entity-inspector"');
    expect(markup).toContain("Valve-1");
    expect(markup).toContain("TagName");
    expect(markup).toContain("OperatedValveReference-1");
    expect(markup).toContain('aria-label="Connected entity query"');
    expect(markup).toContain("Nozzle-1");
  });
});

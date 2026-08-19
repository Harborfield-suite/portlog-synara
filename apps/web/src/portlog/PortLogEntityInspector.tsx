import { useMemo, useState } from "react";

export type PortLogDexpiConnection = {
  id: string;
  ownerId: string;
  fromId: string;
  fromNode: string;
  toId: string;
  toNode: string;
};

export type PortLogDexpiEntity = {
  id: string;
  element: string;
  componentClass: string;
  componentName: string;
  properties: Record<string, string>;
  sourceReferences: string[];
  connections: PortLogDexpiConnection[];
};

export function parsePortLogDexpiEntities(
  contents: string | null,
): Record<string, PortLogDexpiEntity> {
  if (!contents) return {};
  try {
    const parsed: unknown = JSON.parse(contents);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const entities = (parsed as { entities?: unknown }).entities;
    if (!entities || typeof entities !== "object" || Array.isArray(entities)) return {};
    return Object.fromEntries(
      Object.entries(entities).filter((entry): entry is [string, PortLogDexpiEntity] => {
        const value = entry[1];
        return Boolean(
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          typeof (value as PortLogDexpiEntity).id === "string",
        );
      }),
    );
  } catch {
    return {};
  }
}

export function PortLogEntityInspector(props: {
  entity: PortLogDexpiEntity | undefined;
  entities: Record<string, PortLogDexpiEntity>;
}) {
  const [connectionQuery, setConnectionQuery] = useState("");
  const normalizedQuery = connectionQuery.trim().toLowerCase();
  const connections = useMemo(
    () =>
      (props.entity?.connections ?? []).filter((connection) => {
        if (!normalizedQuery) return true;
        return [connection.ownerId, connection.fromId, connection.toId].some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        );
      }),
    [normalizedQuery, props.entity?.connections],
  );

  if (!props.entity) {
    return (
      <aside
        className="flex w-72 shrink-0 flex-col border-l border-border/65 bg-[var(--color-background-surface)]"
        data-testid="portlog-entity-inspector"
      >
        <div className="border-b border-border/65 px-3 py-2 text-xs font-medium">
          Entity inspector
        </div>
        <p className="p-3 text-xs text-muted-foreground">Select a rendered entity to inspect it.</p>
      </aside>
    );
  }

  return (
    <aside
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border/65 bg-[var(--color-background-surface)]"
      data-testid="portlog-entity-inspector"
    >
      <div className="border-b border-border/65 px-3 py-2 text-xs font-medium">
        Entity inspector
      </div>
      <dl className="space-y-2 border-b border-border/65 p-3 text-xs">
        <div>
          <dt className="text-muted-foreground">Identity</dt>
          <dd className="font-mono text-foreground">{props.entity.id}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Element</dt>
          <dd>{props.entity.element}</dd>
        </div>
        {props.entity.componentClass ? (
          <div>
            <dt className="text-muted-foreground">Class</dt>
            <dd>{props.entity.componentClass}</dd>
          </div>
        ) : null}
        {props.entity.componentName ? (
          <div>
            <dt className="text-muted-foreground">Shape</dt>
            <dd>{props.entity.componentName}</dd>
          </div>
        ) : null}
      </dl>

      <section className="border-b border-border/65 p-3 text-xs">
        <h3 className="mb-2 text-muted-foreground">Properties</h3>
        {Object.keys(props.entity.properties).length === 0 ? (
          <p className="text-muted-foreground">No properties.</p>
        ) : (
          <dl className="space-y-1">
            {Object.entries(props.entity.properties).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2">
                <dt className="truncate text-muted-foreground" title={key}>
                  {key}
                </dt>
                <dd className="break-words text-foreground">{value || "—"}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="border-b border-border/65 p-3 text-xs">
        <h3 className="mb-2 text-muted-foreground">Connections</h3>
        <input
          type="search"
          value={connectionQuery}
          onChange={(event) => setConnectionQuery(event.target.value)}
          placeholder="Filter connected entities"
          aria-label="Connected entity query"
          className="mb-2 w-full rounded border border-border bg-background px-2 py-1.5 text-xs outline-none"
        />
        {connections.length === 0 ? (
          <p className="text-muted-foreground">No matching connections.</p>
        ) : (
          <ul className="space-y-1">
            {connections.map((connection) => {
              const otherId =
                connection.fromId === props.entity?.id ? connection.toId : connection.fromId;
              const other = props.entities[otherId];
              return (
                <li key={connection.id} className="rounded border border-border/65 px-2 py-1">
                  <span className="font-mono">{otherId || "unknown"}</span>
                  {other?.componentClass ? (
                    <span className="ml-1 text-muted-foreground">({other.componentClass})</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="p-3 text-xs">
        <h3 className="mb-2 text-muted-foreground">Source references</h3>
        {props.entity.sourceReferences.length === 0 ? (
          <p className="text-muted-foreground">No source references.</p>
        ) : (
          <ul className="space-y-1 font-mono">
            {props.entity.sourceReferences.map((reference) => (
              <li key={reference}>{reference}</li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

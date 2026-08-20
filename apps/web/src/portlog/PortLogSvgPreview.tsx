import {
  useMemo,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import { cn } from "~/lib/utils";

import { usePortLogLocalFile } from "./usePortLogLocalFile";

function sanitizeSvgMarkup(contents: string, selectedEntityId: string | null): string | null {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return null;
  }
  const document = new DOMParser().parseFromString(contents, "image/svg+xml");
  const root = document.documentElement;
  if (root.localName !== "svg" || document.querySelector("parsererror")) {
    return null;
  }

  for (const element of Array.from(
    root.querySelectorAll("script, style, foreignObject, iframe, object, image"),
  )) {
    element.remove();
  }
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "src" || name === "style") {
        element.removeAttribute(attribute.name);
      } else if ((name === "href" || name === "xlink:href") && !value.startsWith("#")) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  if (selectedEntityId) {
    const selected = Array.from(root.querySelectorAll("[data-id]")).find(
      (element) => element.getAttribute("data-id") === selectedEntityId,
    );
    if (selected) {
      const namespace = "http://www.w3.org/2000/svg";
      let defs = root.querySelector("defs");
      if (!defs) {
        defs = document.createElementNS(namespace, "defs");
        root.insertBefore(defs, root.firstChild);
      }
      const filter = document.createElementNS(namespace, "filter");
      filter.setAttribute("id", "portlog-selection-glow");
      filter.setAttribute("x", "-50%");
      filter.setAttribute("y", "-50%");
      filter.setAttribute("width", "200%");
      filter.setAttribute("height", "200%");
      const glow = document.createElementNS(namespace, "feDropShadow");
      glow.setAttribute("dx", "0");
      glow.setAttribute("dy", "0");
      glow.setAttribute("stdDeviation", "1.5");
      glow.setAttribute("flood-color", "#0ea5e9");
      glow.setAttribute("flood-opacity", "0.95");
      filter.append(glow);
      defs.append(filter);
      selected.setAttribute("data-selected", "true");
      selected.setAttribute("filter", "url(#portlog-selection-glow)");
    }
  }
  return new XMLSerializer().serializeToString(root);
}

export function PortLogSvgPreview(props: {
  svgPath: string;
  className?: string;
  selectedEntityId?: string | null;
  onEntitySelect?: (entityId: string | null) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const { contents, grantQuery, fileQuery } = usePortLogLocalFile(props.svgPath);
  const markup = useMemo(
    () => (contents ? sanitizeSvgMarkup(contents, props.selectedEntityId ?? null) : null),
    [contents, props.selectedEntityId],
  );

  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setZoom((current) => Math.min(4, Math.max(0.25, current * (event.deltaY < 0 ? 1.1 : 0.9))));
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ x: event.clientX - pan.x, y: event.clientY - pan.y });
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag) {
      setPan({ x: event.clientX - drag.x, y: event.clientY - drag.y });
    }
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDrag(null);
  };
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const entity = target.closest("[data-id]");
    props.onEntitySelect?.(entity?.getAttribute("data-id") ?? null);
  };

  return (
    <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col", props.className)}>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/65 px-2 text-xs">
        <span className="mr-auto text-muted-foreground">Source-faithful DEXPI drawing</span>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setZoom((current) => Math.min(4, current * 1.25))}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setZoom((current) => Math.max(0.25, current / 1.25))}
        >
          −
        </button>
        <button type="button" onClick={reset}>
          Reset
        </button>
        <span className="w-10 text-right tabular-nums">{Math.round(zoom * 100)}%</span>
      </div>
      {grantQuery.isPending || fileQuery.isPending ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading drawing…
        </div>
      ) : grantQuery.error || fileQuery.error || markup === null ? (
        <div
          role="alert"
          className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-destructive"
        >
          Could not load the rendered DEXPI drawing.
        </div>
      ) : (
        <div
          className="min-h-0 min-w-0 flex-1 cursor-grab overflow-hidden bg-white active:cursor-grabbing"
          data-testid="portlog-svg-viewport"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          onClick={handleClick}
        >
          <div
            className="h-full w-full origin-top-left [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
            data-testid="portlog-svg-canvas"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        </div>
      )}
    </section>
  );
}

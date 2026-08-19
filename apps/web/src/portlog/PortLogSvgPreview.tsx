import { useMemo, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  isLocalPreviewGrantUsable,
  projectLocalPreviewGrantQueryOptions,
  projectReadFileQueryOptions,
} from "~/lib/projectReactQuery";
import { cn } from "~/lib/utils";

function sanitizeSvgMarkup(contents: string): string | null {
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
  return new XMLSerializer().serializeToString(root);
}

export function PortLogSvgPreview(props: { svgPath: string; className?: string }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const grantQuery = useQuery(
    projectLocalPreviewGrantQueryOptions({
      path: props.svgPath,
      enabled: props.svgPath.length > 0,
    }),
  );
  const grant = isLocalPreviewGrantUsable(grantQuery.data) ? grantQuery.data?.grant : null;
  const fileQuery = useQuery(
    projectReadFileQueryOptions({
      cwd: null,
      relativePath: props.svgPath,
      previewGrant: grant,
      enabled: grant !== null,
    }),
  );
  const markup = useMemo(
    () => (fileQuery.data?.contents ? sanitizeSvgMarkup(fileQuery.data.contents) : null),
    [fileQuery.data?.contents],
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
        >
          <div
            className="origin-top-left"
            data-testid="portlog-svg-canvas"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        </div>
      )}
    </section>
  );
}

import type { PortLogRuntimeState } from "@synara/contracts";
import { useEffect, useState } from "react";

const STOPPED_STATE: PortLogRuntimeState = {
  status: "stopped",
  ready: null,
  error: null,
};

function statusLabel(status: PortLogRuntimeState["status"]): string {
  switch (status) {
    case "ready":
      return "Runtime ready";
    case "starting":
      return "Starting runtime…";
    case "error":
      return "Runtime unavailable";
    case "stopped":
      return "Runtime stopped";
  }
}

function statusDotClassName(status: PortLogRuntimeState["status"]): string {
  switch (status) {
    case "ready":
      return "bg-emerald-500";
    case "starting":
      return "animate-pulse bg-amber-500";
    case "error":
      return "bg-red-500";
    case "stopped":
      return "bg-muted-foreground/50";
  }
}

export function PortLogRuntimeStatus() {
  const [state, setState] = useState<PortLogRuntimeState>(STOPPED_STATE);

  useEffect(() => {
    const bridge =
      typeof window === "undefined" ? undefined : window.desktopBridge?.portlogRuntime;
    if (!bridge) return;

    let active = true;
    void bridge.getStatus().then(
      (nextState) => {
        if (active) setState(nextState);
      },
      () => {
        if (active) setState({ status: "error", ready: null, error: "Runtime status unavailable" });
      },
    );
    const unsubscribe = bridge.onStatus((nextState) => {
      if (active) setState(nextState);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (typeof window === "undefined" || !window.desktopBridge?.portlogRuntime) return null;

  return (
    <div
      className="hidden shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground sm:flex"
      role="status"
      aria-label={statusLabel(state.status)}
      title={state.error ?? statusLabel(state.status)}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${statusDotClassName(state.status)}`} />
      <span>{statusLabel(state.status)}</span>
    </div>
  );
}

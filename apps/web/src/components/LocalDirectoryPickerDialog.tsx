import type { FilesystemBrowseResult, NativeApi } from "@synara/contracts";
import { useCallback, useEffect, useState } from "react";

import { getBrowseParentPath, hasTrailingPathSeparator } from "../lib/projectPaths";
import { readNativeApi } from "../nativeApi";
import { CentralIcon } from "~/lib/central-icons";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

function withTrailingSeparator(value: string): string {
  if (hasTrailingPathSeparator(value)) return value;
  return `${value}${value.includes("\\") ? "\\" : "/"}`;
}

export function LocalDirectoryPickerDialog(props: {
  open: boolean;
  initialPath: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
}) {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<FilesystemBrowseResult["entries"]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = useCallback(async (requestedPath: string) => {
    const api: NativeApi | null = readNativeApi();
    if (!api) {
      setError("The app server is unavailable.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.filesystem.browse({
        partialPath: withTrailingSeparator(requestedPath),
      });
      setCurrentPath(result.parentPath);
      setEntries(result.entries);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to browse server folders.");
      setEntries([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!props.open) return;
    setCurrentPath("");
    setEntries([]);
    setError(null);
    void loadDirectory(props.initialPath.trim() || "~");
  }, [loadDirectory, props.initialPath, props.open]);

  const parentPath = currentPath ? getBrowseParentPath(currentPath) : null;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Choose a server folder</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-3 px-5">
          <p className="text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
            Choose a directory on the machine running Synara.
          </p>
          <div className="flex items-center gap-2 rounded-xl border border-foreground/12 px-3 py-2 text-[length:var(--app-font-size-ui-xs,10px)]">
            <CentralIcon name="folder-open" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate" aria-label="Current server folder">
              {currentPath || "Loading…"}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Go to parent folder"
              disabled={loading || parentPath === null}
              onClick={() => {
                if (parentPath) void loadDirectory(parentPath);
              }}
            >
              <CentralIcon name="arrow-up" className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <div
            className="max-h-64 min-h-24 overflow-y-auto rounded-xl border border-foreground/12 p-1"
            aria-label="Server folders"
          >
            {loading ? (
              <p className="px-3 py-4 text-center text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
                Loading folders…
              </p>
            ) : error ? (
              <p role="alert" className="px-3 py-4 text-[length:var(--app-font-size-ui-xs,10px)] text-destructive">
                {error}
              </p>
            ) : entries.length === 0 ? (
              <p className="px-3 py-4 text-center text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
                No subfolders
              </p>
            ) : (
              entries.map((entry) => (
                <button
                  key={entry.fullPath}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-[length:var(--app-font-size-ui-sm,11px)] hover:bg-foreground/6 focus-visible:bg-foreground/6"
                  onClick={() => void loadDirectory(entry.fullPath)}
                >
                  <CentralIcon name="folder-closed" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))
            )}
          </div>
        </DialogPanel>
        <DialogFooter className="px-5 pb-5">
          <Button variant="ghost" shape="capsule" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="prominent"
            shape="capsule"
            disabled={loading || !currentPath || error !== null}
            onClick={() => {
              if (currentPath) {
                props.onSelect(currentPath);
                props.onOpenChange(false);
              }
            }}
          >
            Use this folder
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

import { useQuery } from "@tanstack/react-query";

import {
  isLocalPreviewGrantUsable,
  projectLocalPreviewGrantQueryOptions,
  projectReadFileQueryOptions,
} from "~/lib/projectReactQuery";

export function usePortLogLocalFile(
  path: string,
  inlineContents?: string,
  workspaceRoot?: string | null,
) {
  const readsWorkspace = workspaceRoot !== undefined && workspaceRoot !== null;
  const grantQuery = useQuery(
    projectLocalPreviewGrantQueryOptions({
      path,
      enabled: path.length > 0 && inlineContents === undefined && !readsWorkspace,
    }),
  );
  const grant = isLocalPreviewGrantUsable(grantQuery.data) ? grantQuery.data?.grant : null;
  const fileQuery = useQuery(
    projectReadFileQueryOptions({
      cwd: workspaceRoot ?? null,
      relativePath: path,
      previewGrant: grant,
      enabled: inlineContents === undefined && (readsWorkspace || grant !== null),
    }),
  );

  return {
    contents: inlineContents ?? fileQuery.data?.contents ?? null,
    grantQuery,
    fileQuery,
  };
}

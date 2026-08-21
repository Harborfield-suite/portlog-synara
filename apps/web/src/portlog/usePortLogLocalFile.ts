import { useQuery } from "@tanstack/react-query";

import {
  isLocalPreviewGrantUsable,
  projectLocalPreviewGrantQueryOptions,
  projectReadFileQueryOptions,
} from "~/lib/projectReactQuery";

export function usePortLogLocalFile(path: string) {
  const grantQuery = useQuery(
    projectLocalPreviewGrantQueryOptions({
      path,
      enabled: path.length > 0,
    }),
  );
  const grant = isLocalPreviewGrantUsable(grantQuery.data) ? grantQuery.data?.grant : null;
  const fileQuery = useQuery(
    projectReadFileQueryOptions({
      cwd: null,
      relativePath: path,
      previewGrant: grant,
      enabled: grant !== null,
    }),
  );

  return {
    contents: fileQuery.data?.contents ?? null,
    grantQuery,
    fileQuery,
  };
}

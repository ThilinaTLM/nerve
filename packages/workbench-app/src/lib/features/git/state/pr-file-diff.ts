import type { GithubPrFile } from "@nervekit/contracts";

export function prFileDiffStateKey(
  baseOid: string,
  headOid: string,
  file: Pick<GithubPrFile, "path" | "previousPath" | "status">,
): string {
  return JSON.stringify([
    baseOid,
    headOid,
    file.path,
    file.previousPath ?? "",
    file.status,
  ]);
}

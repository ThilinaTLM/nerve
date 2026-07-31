import type { LatestRelease } from "@nervekit/contracts";

export const releaseState = $state({
  latest: undefined as LatestRelease | undefined,
});

import type { LatestRelease } from "@nervekit/contracts/status";

export const releaseState = $state({
  latest: undefined as LatestRelease | undefined,
});

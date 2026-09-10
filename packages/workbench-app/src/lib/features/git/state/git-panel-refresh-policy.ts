export type GitProjectRefreshRequestState = {
  discoveryRequest: { inFlight: boolean; loadsDetails: boolean };
};

/** Join an active discovery request, promoting it when repo details are needed. */
export function joinGitProjectRefresh(
  state: GitProjectRefreshRequestState,
  loadDetails: boolean,
): boolean {
  if (!state.discoveryRequest.inFlight) return false;
  state.discoveryRequest.loadsDetails ||= loadDetails;
  return true;
}

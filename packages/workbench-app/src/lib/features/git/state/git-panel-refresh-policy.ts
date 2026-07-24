export type GitProjectRefreshRequestState = {
  reposRequestInFlight: boolean;
  activeRequestLoadsDetails: boolean;
};

/** Join an active discovery request, promoting it when repo details are needed. */
export function joinGitProjectRefresh(
  state: GitProjectRefreshRequestState,
  loadDetails: boolean,
): boolean {
  if (!state.reposRequestInFlight) return false;
  state.activeRequestLoadsDetails ||= loadDetails;
  return true;
}

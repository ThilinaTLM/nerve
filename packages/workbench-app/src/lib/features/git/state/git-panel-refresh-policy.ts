export type GitPanelRefreshOptions = {
  silent?: boolean;
  force?: boolean;
  uncertain?: boolean;
  onlyIfChanged?: boolean;
  loadDetails?: boolean;
  criticalErrorTitle?: string;
};

export function gitAutomaticOverviewOptions(demand: { uncertain?: boolean }) {
  return {
    force: !demand.uncertain,
    uncertain: Boolean(demand.uncertain),
    silent: true,
    onlyIfChanged: true,
  };
}

/** Join the active UI demand and retain at most one trailing refresh. Hard wins. */
export function joinGitOverviewRefresh(
  request: {
    inFlight: boolean;
    refreshQueued: boolean;
    queuedUncertain?: boolean;
  },
  options: { force?: boolean; uncertain?: boolean },
): boolean {
  if (!request.inFlight) return false;
  if (options.force || options.uncertain) {
    request.queuedUncertain = request.refreshQueued
      ? Boolean(request.queuedUncertain && options.uncertain)
      : Boolean(options.uncertain);
    request.refreshQueued = true;
  }
  return true;
}

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

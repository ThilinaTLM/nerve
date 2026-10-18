export type GitPanelRefreshOptions = {
  silent?: boolean;
  force?: boolean;
  uncertain?: boolean;
  onlyIfChanged?: boolean;
  loadDetails?: boolean;
  criticalErrorTitle?: string;
};

export function gitOverviewReadInvalidation(
  options: { force?: boolean; uncertain?: boolean },
  knownInvalidated: boolean,
): "hard" | "soft" | undefined {
  return options.force
    ? "hard"
    : options.uncertain || knownInvalidated
      ? "soft"
      : undefined;
}

/** Cached or already-pending query data cannot erase known invalidation until
 * this demand starts a genuine read; newer notices still invalidate that read. */
export function createGitOverviewReadGuard(
  request: { invalidation?: number },
  knownInvalidated: boolean,
) {
  let invalidation = request.invalidation ?? 0;
  let needsRead = knownInvalidated;
  return {
    begin: () => {
      needsRead = false;
      invalidation = request.invalidation ?? 0;
    },
    expectRead: () => {
      needsRead = true;
    },
    isStale: (value: { stale?: boolean }) =>
      needsRead ||
      Boolean(value.stale) ||
      (request.invalidation ?? 0) !== invalidation,
  };
}

export function gitAutomaticOverviewOptions(demand: { uncertain?: boolean }) {
  return {
    force: !demand.uncertain,
    uncertain: Boolean(demand.uncertain),
    silent: true,
    onlyIfChanged: true,
  };
}

/** Join the active UI demand and retain at most one trailing refresh. Hard wins. */
export function joinGitReadRefresh(
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

/** A bounded stale-result follow-up may absorb soft notices, never an explicit
 * hard refresh already queued by the user or an actual filesystem change. */
export function consumeGitReadSoftDemand(request: {
  refreshQueued: boolean;
  queuedUncertain?: boolean;
}): boolean {
  if (request.refreshQueued && !request.queuedUncertain) return false;
  request.refreshQueued = false;
  request.queuedUncertain = undefined;
  return true;
}

export function takeGitReadQueuedRefresh(
  request: { refreshQueued: boolean; queuedUncertain?: boolean },
  followedUp: boolean,
  hasDemand = true,
): GitPanelRefreshOptions | undefined {
  if (!request.refreshQueued) return;
  const uncertain = Boolean(request.queuedUncertain);
  request.refreshQueued = false;
  request.queuedUncertain = undefined;
  if (uncertain && (followedUp || !hasDemand)) return;
  return { silent: true, force: !uncertain, uncertain, onlyIfChanged: true };
}

export type GitProjectRefreshRequestState = {
  discoveryRequest: {
    inFlight: boolean;
    loadsDetails: boolean;
    refreshQueued: boolean;
    queuedUncertain?: boolean;
  };
};

/** Join an active discovery request, promoting it when repo details are needed. */
export function joinGitProjectRefresh(
  state: GitProjectRefreshRequestState,
  loadDetails: boolean,
  options: { force?: boolean; uncertain?: boolean } = {},
): boolean {
  if (!state.discoveryRequest.inFlight) return false;
  state.discoveryRequest.loadsDetails ||= loadDetails;
  return joinGitReadRefresh(state.discoveryRequest, options);
}

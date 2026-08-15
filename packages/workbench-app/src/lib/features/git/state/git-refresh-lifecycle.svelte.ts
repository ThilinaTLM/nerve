import { prViewKey } from "$lib/core/state/state-keys";
import {
  pollVisiblePendingPrLists,
  refreshVisibleGitDemand,
} from "./git-panel-refresh.svelte";
import { refreshPendingPrChecks } from "./git-refresh-coordinator.svelte";
import { startGitRefreshLoop } from "./git-refresh-loop";
import { PR_PENDING_POLL_MS } from "./git-refresh-policy";
import { gitState } from "./git-state.svelte";

let activePrId: string | undefined;
let stopLoop: (() => void) | undefined;

export function setActivePrRefreshDemand(id: string | undefined): void {
  activePrId = id;
}

function activePrDemand() {
  const view = activePrId ? gitState.prViews[prViewKey(activePrId)] : undefined;
  return view
    ? {
        view,
        demand: {
          projectId: view.projectId,
          repo: view.repo,
          number: view.number,
          pending: view.checks.data?.checks.status === "pending",
        },
      }
    : undefined;
}

function pollPendingDemand(): void {
  const active = activePrDemand();
  pollVisiblePendingPrLists(active?.demand);
  if (active?.demand.pending) refreshPendingPrChecks(active.view);
}

export function startGitRefreshCoordinator(onFocus?: () => void): () => void {
  if (typeof window === "undefined" || stopLoop)
    return stopGitRefreshCoordinator;
  stopLoop = startGitRefreshLoop(
    {
      pollPending: pollPendingDemand,
      refreshVisible: refreshVisibleGitDemand,
      refreshContext: () => onFocus?.(),
    },
    {
      visible: () => document.visibilityState === "visible",
      setInterval: (callback, intervalMs) =>
        window.setInterval(callback, intervalMs),
      clearInterval: (timer) => window.clearInterval(timer as number),
      addFocusListener: (listener) =>
        window.addEventListener("focus", listener),
      removeFocusListener: (listener) =>
        window.removeEventListener("focus", listener),
      addVisibilityListener: (listener) =>
        document.addEventListener("visibilitychange", listener),
      removeVisibilityListener: (listener) =>
        document.removeEventListener("visibilitychange", listener),
    },
    PR_PENDING_POLL_MS,
  );
  return stopGitRefreshCoordinator;
}

export function stopGitRefreshCoordinator(): void {
  stopLoop?.();
  stopLoop = undefined;
}

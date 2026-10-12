import { getLaunchLogs } from "$lib/features/launches/api/launches.api";
import {
  appendLaunchLogPage,
  prependLaunchLogPage,
} from "$lib/features/launches/views";
import { SvelteMap } from "svelte/reactivity";
import { launchState } from "./launch-state.svelte";

const LOG_PAGE_SIZE = 500;

let initialRequest = 0;
const earlierRequests = new SvelteMap<string, Promise<void>>();
let refreshRequest: Promise<void> | undefined;
let refreshRequested = false;

export async function loadLaunchLogWindow(launchId: string): Promise<void> {
  const request = ++initialRequest;
  const response = await getLaunchLogs(launchId, {
    mode: "recent",
    limit: LOG_PAGE_SIZE,
  });
  if (request !== initialRequest || launchState.selectedLaunchId !== launchId)
    return;
  launchState.launchLogs = response;
}

export function loadEarlierLaunchLogs(launchId: string): Promise<void> {
  const existing = earlierRequests.get(launchId);
  if (existing) return existing;
  const current = launchState.launchLogs;
  const beforeSeq = current?.events[0]?.seq;
  if (
    launchState.selectedLaunchId !== launchId ||
    current?.launch.id !== launchId ||
    !current.hasMoreBefore ||
    beforeSeq === undefined
  ) {
    return Promise.resolve();
  }

  const windowGeneration = initialRequest;
  const request = getLaunchLogs(launchId, {
    mode: "recent",
    beforeSeq,
    limit: LOG_PAGE_SIZE,
  })
    .then((older) => {
      const latest = launchState.launchLogs;
      // Drop the page if the window was reloaded meanwhile (jump to latest).
      if (
        launchState.selectedLaunchId !== launchId ||
        latest?.launch.id !== launchId ||
        windowGeneration !== initialRequest
      )
        return;
      launchState.launchLogs = prependLaunchLogPage(latest, older);
    })
    .finally(() => earlierRequests.delete(launchId));
  earlierRequests.set(launchId, request);
  return request;
}

export function refreshLaunchLogWindow(
  launchId = launchState.selectedLaunchId,
): Promise<void> {
  if (!launchId) return Promise.resolve();
  refreshRequested = true;
  if (refreshRequest) return refreshRequest;

  refreshRequest = (async () => {
    do {
      refreshRequested = false;
      let current = launchState.launchLogs;
      // A window paged far back no longer holds the tail; it rejoins live
      // output only through an explicit reload (jump to latest).
      if (
        launchState.selectedLaunchId !== launchId ||
        current?.launch.id !== launchId ||
        current.hasMoreAfter
      )
        return;

      let newer = await getLaunchLogs(launchId, {
        mode: "since_cursor",
        sinceSeq: current.nextCursor,
        limit: LOG_PAGE_SIZE,
      });
      while (true) {
        current = launchState.launchLogs;
        if (
          launchState.selectedLaunchId !== launchId ||
          current?.launch.id !== launchId
        )
          return;
        launchState.launchLogs = appendLaunchLogPage(current, newer);
        if (!newer.hasMoreAfter) break;
        newer = await getLaunchLogs(launchId, {
          mode: "since_cursor",
          sinceSeq: newer.nextCursor,
          limit: LOG_PAGE_SIZE,
        });
      }
    } while (refreshRequested);
  })().finally(() => {
    refreshRequest = undefined;
  });

  return refreshRequest;
}

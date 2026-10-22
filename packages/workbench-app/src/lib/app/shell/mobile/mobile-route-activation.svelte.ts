import { untrack } from "svelte";
import {
  newConversationInProject,
  selectCenterTab,
  selectProject,
  workspaceSelectors,
  workspaceState,
  type CenterTabIdentity,
} from "$lib/application/workspace";
import { openConversation } from "$lib/application/workspace";
import { settingsSelectors } from "$lib/features/settings";
import { openLaunchTab, launchSelectors } from "$lib/features/launches";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import { launchProject } from "./mobile-activity";
import {
  mobileRouteForCenterTab,
  mobileRouteProjectId,
  mobileRoutesEqual,
  type MobileCenterIdentity,
  type MobileRoute,
} from "./mobile-routes";
import {
  mobileFollowerSuppressed,
  mobileNav,
  pushMobileScreen,
  replaceMobileScreen,
  suppressMobileFollower,
} from "./mobile-shell.svelte";

/**
 * Bridges the phone route stack and the shared workspace selection. Center
 * hosts and project screens read the globally active project and center tab,
 * so whichever route is on top owns that selection while it is visible.
 */

function sameIdentity(
  a: CenterTabIdentity | undefined,
  b: MobileCenterIdentity,
): boolean {
  return a?.kind === b.kind && a.id === b.id;
}

function routeIdentity(route: MobileRoute): MobileCenterIdentity | undefined {
  if (route.kind === "center") return route.identity;
  return undefined;
}

/** Restore the workspace selection a route renders from. */
export async function activateMobileRoute(route: MobileRoute): Promise<void> {
  await suppressMobileFollower(async () => {
    const projectId = mobileRouteProjectId(route);
    if (projectId && workspaceState.selectedProjectId !== projectId) {
      await selectProject(projectId);
    }
    if (route.kind === "launch") {
      await showLaunchRun(route.launchId);
      return;
    }
    const identity = routeIdentity(route);
    if (!identity || sameIdentity(workspaceState.activeCenterTab, identity)) {
      return;
    }
    const open = workspaceState.openCenterTabs.find((tab) =>
      sameIdentity(tab, identity),
    );
    if (open) {
      await selectCenterTab(open);
    } else if (identity.kind === "conversation") {
      await openConversation(identity.id);
    }
  });
}

/**
 * Launch output streams only for the run shown in the active center tab, so the
 * phone output screen keeps that tab pointed at its run.
 */
async function showLaunchRun(launchId: string): Promise<void> {
  if (
    launchSelectors.activeCenterLaunch?.id === launchId &&
    launchSelectors.selectedLaunch?.id === launchId
  ) {
    return;
  }
  if (!launchSelectors.launches.some((launch) => launch.id === launchId))
    return;
  await openLaunchTab(launchId);
}

function launchRoute(launch: LaunchRecord): MobileRoute {
  const projectId = launchProject(launch, workspaceSelectors.projects)?.id;
  return {
    kind: "launch",
    launchId: launch.id,
    ...(projectId ? { projectId } : {}),
  };
}

/** Open a launch run's phone output screen; the route activation loads it. */
export function openMobileLaunchOutput(launchId: string): void {
  const launch = launchSelectors.launches.find(
    (candidate) => candidate.id === launchId,
  );
  pushMobileScreen(launch ? launchRoute(launch) : { kind: "launch", launchId });
}

/**
 * Run a workspace open action and push the center tab it activates, provided
 * it is the kind the caller asked for (a failed open pushes nothing).
 */
export async function openMobileCenter(
  kind: CenterTabIdentity["kind"],
  open: () => unknown,
): Promise<void> {
  await suppressMobileFollower(open);
  const active = workspaceState.activeCenterTab;
  if (active?.kind !== kind) return;
  pushMobileScreen(mobileRouteForCenterTab(active));
}

/** Conversations push first so the transcript screen appears immediately. */
export async function openMobileConversation(
  conversationId: string,
): Promise<void> {
  pushMobileScreen({
    kind: "center",
    identity: { kind: "conversation", id: conversationId },
  });
  await suppressMobileFollower(() => openConversation(conversationId));
}

/**
 * Start a chat in a project. The project switch runs suppressed so its restored
 * tab session is not mistaken for navigation; the pending chat it then opens is
 * pushed by the follower.
 */
export async function startMobileConversation(project: {
  id: string;
  directory: string;
}): Promise<void> {
  await suppressMobileFollower(() => selectProject(project.id));
  newConversationInProject(project.directory);
}

/**
 * Follow center tabs the app opens on its own — a file link in a transcript,
 * accept-plan-in-new-chat, a settings shortcut — by pushing a matching route.
 * Must be called during component initialisation.
 */
export function followMobileCenterTab(): void {
  let lastKind: CenterTabIdentity["kind"] | undefined;
  let lastKey: string | undefined;
  let initialized = false;

  $effect(() => {
    const active = workspaceState.activeCenterTab;
    const key = active ? `${active.kind}:${active.id}` : undefined;
    if (!initialized) {
      initialized = true;
      lastKey = key;
      lastKind = active?.kind;
      return;
    }
    if (key === lastKey) return;
    const previousKind = lastKind;
    lastKey = key;
    lastKind = active?.kind;
    if (!active || mobileFollowerSuppressed()) return;

    untrack(() => {
      const launch =
        active.kind === "launch"
          ? launchSelectors.activeCenterLaunch
          : undefined;
      const route = launch
        ? launchRoute(launch)
        : mobileRouteForCenterTab(
            active,
            active.kind === "settings"
              ? settingsSelectors.activePageId
              : active.kind === "project-settings"
                ? settingsSelectors.projectPageId(active.id)
                : undefined,
          );
      const top = mobileNav.top;
      if (mobileRoutesEqual(top, route)) return;
      // A first prompt turns the pending chat into a real conversation.
      if (
        previousKind === "pending-conversation" &&
        active.kind === "conversation"
      ) {
        if (
          top?.kind === "center" &&
          top.identity.kind === "pending-conversation"
        ) {
          replaceMobileScreen(route);
        }
        return;
      }
      pushMobileScreen(route);
    });
  });
}

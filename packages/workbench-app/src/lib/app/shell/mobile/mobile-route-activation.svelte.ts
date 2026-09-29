import { untrack } from "svelte";
import {
  newConversationInProject,
  selectCenterTab,
  selectProject,
  workspaceSelectors,
  workspaceState,
  type CenterTabIdentity,
} from "$lib/application/workspace";
import { openConversation } from "$lib/features/conversations";
import { settingsSelectors } from "$lib/features/settings";
import { openTaskTab, taskSelectors } from "$lib/features/tasks";
import type { TaskRecord } from "@nervekit/contracts/tasks";
import { taskProject } from "./mobile-activity";
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
  if (route.kind === "context") {
    return { kind: "conversation", id: route.conversationId };
  }
  return undefined;
}

/** Restore the workspace selection a route renders from. */
export async function activateMobileRoute(route: MobileRoute): Promise<void> {
  await suppressMobileFollower(async () => {
    const projectId = mobileRouteProjectId(route);
    if (projectId && workspaceState.selectedProjectId !== projectId) {
      await selectProject(projectId);
    }
    if (route.kind === "task") {
      await showTaskRun(route.taskId);
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
 * Task output streams only for the run shown in the active center tab, so the
 * phone output screen keeps that tab pointed at its run.
 */
async function showTaskRun(taskId: string): Promise<void> {
  if (
    taskSelectors.activeCenterTask?.id === taskId &&
    taskSelectors.selectedTask?.id === taskId
  ) {
    return;
  }
  if (!taskSelectors.tasks.some((task) => task.id === taskId)) return;
  await openTaskTab(taskId);
}

function taskRoute(task: TaskRecord): MobileRoute {
  const projectId = taskProject(task, workspaceSelectors.projects)?.id;
  return { kind: "task", taskId: task.id, ...(projectId ? { projectId } : {}) };
}

/** Open a task run's phone output screen; the route activation loads it. */
export function openMobileTaskOutput(taskId: string): void {
  const task = taskSelectors.tasks.find((candidate) => candidate.id === taskId);
  pushMobileScreen(task ? taskRoute(task) : { kind: "task", taskId });
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
  dir: string;
}): Promise<void> {
  await suppressMobileFollower(() => selectProject(project.id));
  newConversationInProject(project.dir);
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
      const task =
        active.kind === "task" ? taskSelectors.activeCenterTask : undefined;
      const route = task
        ? taskRoute(task)
        : mobileRouteForCenterTab(
            active,
            active.kind === "settings"
              ? settingsSelectors.activePageId
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

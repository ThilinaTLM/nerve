import type { CenterTabIdentity } from "$lib/application/workspace";

/**
 * Phone navigation model.
 *
 * Three root tabs sit in the thumb zone; each owns its own push/pop stack of
 * full-screen routes. The root screen is implicit (an empty stack shows it), so
 * switching tabs and coming back lands where the reader left off.
 */
export const MOBILE_TAB_IDS = ["inbox", "projects", "activity"] as const;
export type MobileTabId = (typeof MOBILE_TAB_IDS)[number];

/** Deep enough for project → files ×n → file, shallow enough to stay cheap. */
export const MOBILE_STACK_LIMIT = 12;

export type MobileCenterIdentity = {
  kind: CenterTabIdentity["kind"];
  id: string;
};

export type MobileRoute =
  | { kind: "project"; projectId: string }
  | { kind: "conversations"; projectId: string }
  | { kind: "files"; projectId: string; path: string }
  | { kind: "tasks"; projectId: string }
  | { kind: "task"; taskId: string; projectId?: string }
  | { kind: "notes"; projectId: string }
  | { kind: "note"; projectId: string; noteId: string }
  | { kind: "git"; projectId: string }
  | { kind: "pull-requests"; projectId: string }
  | { kind: "branches"; projectId: string }
  | { kind: "context"; conversationId: string }
  | { kind: "center"; identity: MobileCenterIdentity }
  | { kind: "settings" }
  | { kind: "settings-page"; pageId: string }
  | { kind: "logs" };

export type MobileNavState = {
  tab: MobileTabId;
  stacks: Record<MobileTabId, MobileRoute[]>;
};

export function initialMobileNavState(): MobileNavState {
  return { tab: "inbox", stacks: { inbox: [], projects: [], activity: [] } };
}

export function isMobileTabId(value: string): value is MobileTabId {
  return (MOBILE_TAB_IDS as readonly string[]).includes(value);
}

export function mobileRouteKey(route: MobileRoute): string {
  switch (route.kind) {
    case "project":
    case "conversations":
    case "tasks":
    case "notes":
    case "git":
    case "pull-requests":
    case "branches":
      return `${route.kind}:${route.projectId}`;
    case "files":
      return `files:${route.projectId}:${route.path}`;
    case "note":
      return `note:${route.projectId}:${route.noteId}`;
    case "task":
      return `task:${route.taskId}`;
    case "context":
      return `context:${route.conversationId}`;
    case "center":
      return `center:${route.identity.kind}:${route.identity.id}`;
    case "settings-page":
      return `settings-page:${route.pageId}`;
    case "settings":
    case "logs":
      return route.kind;
  }
}

export function mobileRoutesEqual(
  a: MobileRoute | undefined,
  b: MobileRoute | undefined,
): boolean {
  if (!a || !b) return a === b;
  return mobileRouteKey(a) === mobileRouteKey(b);
}

export function topMobileRoute(
  state: MobileNavState,
  tab: MobileTabId = state.tab,
): MobileRoute | undefined {
  return state.stacks[tab].at(-1);
}

/** Re-tapping the active tab pops to its root, matching the platform gesture. */
export function selectMobileTab(
  state: MobileNavState,
  tab: MobileTabId,
): MobileNavState {
  if (tab !== state.tab) return { ...state, tab };
  if (state.stacks[tab].length === 0) return state;
  return resetMobileTab(state, tab);
}

/**
 * Pushing a route already in the stack pops back to it instead of stacking a
 * duplicate; past the limit the oldest entry is dropped.
 */
export function pushMobileRoute(
  state: MobileNavState,
  route: MobileRoute,
  tab: MobileTabId = state.tab,
): MobileNavState {
  const stack = state.stacks[tab];
  const key = mobileRouteKey(route);
  const existing = stack.findIndex(
    (candidate) => mobileRouteKey(candidate) === key,
  );
  let next: MobileRoute[];
  if (existing >= 0) {
    next = stack.slice(0, existing + 1);
  } else {
    next = [...stack, route];
    if (next.length > MOBILE_STACK_LIMIT) {
      next = next.slice(next.length - MOBILE_STACK_LIMIT);
    }
  }
  return { tab, stacks: { ...state.stacks, [tab]: next } };
}

/** Swap the top route, e.g. when a pending chat becomes a real conversation. */
export function replaceTopMobileRoute(
  state: MobileNavState,
  route: MobileRoute,
): MobileNavState {
  const stack = state.stacks[state.tab];
  if (stack.length === 0) return pushMobileRoute(state, route);
  const withoutTop: MobileNavState = {
    ...state,
    stacks: { ...state.stacks, [state.tab]: stack.slice(0, -1) },
  };
  return pushMobileRoute(withoutTop, route);
}

export function popMobileRoute(state: MobileNavState): MobileNavState {
  const stack = state.stacks[state.tab];
  if (stack.length === 0) return state;
  return {
    ...state,
    stacks: { ...state.stacks, [state.tab]: stack.slice(0, -1) },
  };
}

/** Keep routes up to and including `index`; -1 returns to the root screen. */
export function popMobileRouteTo(
  state: MobileNavState,
  index: number,
): MobileNavState {
  const stack = state.stacks[state.tab];
  if (index >= stack.length - 1) return state;
  return {
    ...state,
    stacks: { ...state.stacks, [state.tab]: stack.slice(0, index + 1) },
  };
}

export function resetMobileTab(
  state: MobileNavState,
  tab: MobileTabId = state.tab,
): MobileNavState {
  return { ...state, stacks: { ...state.stacks, [tab]: [] } };
}

/** The project a route needs selected before it renders, if any. */
export function mobileRouteProjectId(route: MobileRoute): string | undefined {
  return "projectId" in route ? route.projectId : undefined;
}

/**
 * How many browser history entries the shell should own: one per route the
 * system back gesture can pop on the visible tab.
 */
export function mobileHistoryDepth(state: MobileNavState): number {
  return state.stacks[state.tab].length;
}

/**
 * The route a center-tab activation lands on. Settings and logs have native
 * phone screens; everything else renders its registered center host.
 */
export function mobileRouteForCenterTab(
  identity: CenterTabIdentity,
  settingsPageId?: string,
): MobileRoute {
  if (identity.kind === "settings") {
    return settingsPageId
      ? { kind: "settings-page", pageId: settingsPageId }
      : { kind: "settings" };
  }
  if (identity.kind === "logs") return { kind: "logs" };
  return { kind: "center", identity: { kind: identity.kind, id: identity.id } };
}

/*
 * The stack survives a page reload through per-tab session storage. Restored
 * data is untrusted: anything malformed resets to the inbox, and center routes
 * other than conversations are dropped because their tab view state is gone.
 */

const PROJECT_ROUTE_KINDS = new Set([
  "project",
  "conversations",
  "tasks",
  "notes",
  "git",
  "pull-requests",
  "branches",
]);

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseMobileRoute(value: unknown): MobileRoute | undefined {
  if (!value || typeof value !== "object") return undefined;
  const route = value as Record<string, unknown>;
  const kind = route.kind;
  if (typeof kind !== "string") return undefined;
  if (PROJECT_ROUTE_KINDS.has(kind)) {
    return isText(route.projectId)
      ? ({ kind, projectId: route.projectId } as MobileRoute)
      : undefined;
  }
  switch (kind) {
    case "files":
      return isText(route.projectId) && typeof route.path === "string"
        ? { kind, projectId: route.projectId, path: route.path }
        : undefined;
    case "note":
      return isText(route.projectId) && isText(route.noteId)
        ? { kind, projectId: route.projectId, noteId: route.noteId }
        : undefined;
    case "task":
      if (!isText(route.taskId)) return undefined;
      return isText(route.projectId)
        ? { kind, taskId: route.taskId, projectId: route.projectId }
        : { kind, taskId: route.taskId };
    case "context":
      return isText(route.conversationId)
        ? { kind, conversationId: route.conversationId }
        : undefined;
    case "center": {
      const identity = route.identity as Record<string, unknown> | undefined;
      return identity?.kind === "conversation" && isText(identity.id)
        ? { kind, identity: { kind: "conversation", id: identity.id } }
        : undefined;
    }
    case "settings-page":
      return isText(route.pageId) ? { kind, pageId: route.pageId } : undefined;
    case "settings":
    case "logs":
      return { kind };
    default:
      return undefined;
  }
}

export function serializeMobileNav(state: MobileNavState): string {
  return JSON.stringify(state);
}

export function parseMobileNav(raw: string | null): MobileNavState {
  const initial = initialMobileNavState();
  if (!raw) return initial;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return initial;
  }
  if (!value || typeof value !== "object") return initial;
  const { tab, stacks } = value as { tab?: unknown; stacks?: unknown };
  if (typeof tab !== "string" || !isMobileTabId(tab)) return initial;
  if (!stacks || typeof stacks !== "object") return initial;
  const restored = initial;
  restored.tab = tab;
  for (const id of MOBILE_TAB_IDS) {
    const stack = (stacks as Record<string, unknown>)[id];
    if (!Array.isArray(stack)) continue;
    const routes = stack.flatMap((route) => parseMobileRoute(route) ?? []);
    let next = initialMobileNavState();
    for (const route of routes) next = pushMobileRoute(next, route, "inbox");
    restored.stacks[id] = next.stacks.inbox;
  }
  return restored;
}

function routeConversationId(route: MobileRoute): string | undefined {
  if (route.kind === "context") return route.conversationId;
  if (route.kind === "center" && route.identity.kind === "conversation") {
    return route.identity.id;
  }
  return undefined;
}

/**
 * Cut each stack at the first route whose project or conversation no longer
 * exists; everything above it was reached through it.
 */
export function pruneMissingRoutes(
  state: MobileNavState,
  existing: {
    projectIds: ReadonlySet<string>;
    conversationIds: ReadonlySet<string>;
  },
): MobileNavState {
  let changed = false;
  const stacks = { ...state.stacks };
  for (const id of MOBILE_TAB_IDS) {
    const stack = state.stacks[id];
    const missing = stack.findIndex((route) => {
      const projectId = mobileRouteProjectId(route);
      if (projectId && !existing.projectIds.has(projectId)) return true;
      const conversationId = routeConversationId(route);
      return (
        conversationId !== undefined &&
        !existing.conversationIds.has(conversationId)
      );
    });
    if (missing < 0) continue;
    stacks[id] = stack.slice(0, missing);
    changed = true;
  }
  return changed ? { ...state, stacks } : state;
}

/** Routes popped by the system back gesture, kept so Forward can restore them. */
export type MobileForwardRoutes = { tab: MobileTabId; routes: MobileRoute[] };

export type MobileHistoryPop =
  /** Landed on the entry the shell already shows, e.g. its own rewind. */
  | { kind: "ignore" }
  /** Back (possibly several entries from the long-press history menu). */
  | { kind: "back"; count: number }
  /** Forward onto routes popped earlier; push them again in order. */
  | { kind: "forward"; routes: MobileRoute[]; remaining: MobileRoute[] }
  /** Forward onto entries whose routes are gone; step history back. */
  | { kind: "rewind"; count: number };

/**
 * Decide what a history pop means from the depth the shell owns and the depth
 * recorded on the entry the browser landed on.
 */
export function resolveMobileHistoryPop(input: {
  depth: number;
  reached: number;
  tab: MobileTabId;
  forward?: MobileForwardRoutes;
}): MobileHistoryPop {
  const { depth, reached, tab, forward } = input;
  if (reached === depth) return { kind: "ignore" };
  if (reached < depth) return { kind: "back", count: depth - reached };
  const count = reached - depth;
  if (forward?.tab === tab && forward.routes.length >= count) {
    return {
      kind: "forward",
      routes: forward.routes.slice(0, count),
      remaining: forward.routes.slice(count),
    };
  }
  return { kind: "rewind", count };
}

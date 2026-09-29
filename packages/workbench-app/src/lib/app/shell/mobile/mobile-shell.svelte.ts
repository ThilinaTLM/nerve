import { tick } from "svelte";
import {
  initialMobileNavState,
  parseMobileNav,
  popMobileRoute,
  pruneMissingRoutes,
  popMobileRouteTo,
  pushMobileRoute,
  replaceTopMobileRoute,
  selectMobileTab,
  serializeMobileNav,
  topMobileRoute,
  type MobileNavState,
  type MobileRoute,
  type MobileTabId,
} from "./mobile-routes";

/**
 * Phone navigation state. It survives a reload of this browser tab through
 * session storage (never shared across tabs or devices); a new tab starts at
 * the inbox. Routes to projects or conversations that no longer exist are
 * pruned once the workspace has loaded.
 */
const NAV_STORAGE_KEY = "nerve.mobileNav.v1";

function readStoredNav(): MobileNavState {
  if (typeof window === "undefined") return initialMobileNavState();
  try {
    return parseMobileNav(window.sessionStorage.getItem(NAV_STORAGE_KEY));
  } catch {
    return initialMobileNavState();
  }
}

let nav = $state<MobileNavState>(readStoredNav());

if (typeof window !== "undefined") {
  $effect.root(() => {
    $effect(() => {
      const serialized = serializeMobileNav(nav);
      try {
        window.sessionStorage.setItem(NAV_STORAGE_KEY, serialized);
      } catch {
        // Storage can be full or disabled; navigation still works in memory.
      }
    });
  });
}

export const mobileNav = {
  get state(): MobileNavState {
    return nav;
  },
  get tab(): MobileTabId {
    return nav.tab;
  },
  get stack(): readonly MobileRoute[] {
    return nav.stacks[nav.tab];
  },
  get top(): MobileRoute | undefined {
    return topMobileRoute(nav);
  },
};

export function selectMobileTabId(tab: MobileTabId): void {
  nav = selectMobileTab(nav, tab);
}

export function pushMobileScreen(route: MobileRoute, tab?: MobileTabId): void {
  nav = pushMobileRoute(nav, route, tab);
}

export function replaceMobileScreen(route: MobileRoute): void {
  nav = replaceTopMobileRoute(nav, route);
}

export function backFromMobileScreen(): void {
  nav = popMobileRoute(nav);
}

export function popMobileScreenTo(index: number): void {
  nav = popMobileRouteTo(nav, index);
}

export function pruneMobileNav(existing: {
  projectIds: ReadonlySet<string>;
  conversationIds: ReadonlySet<string>;
}): void {
  nav = pruneMissingRoutes(nav, existing);
}

export function resetMobileNav(): void {
  nav = initialMobileNavState();
}

/*
 * While the phone shell itself changes workspace selection (restoring a
 * route's project or center tab, or opening something it already pushed), the
 * center follower must not treat the resulting active-tab changes as
 * app-initiated navigation. Deliberately not reactive: reading it inside the
 * follower effect must not subscribe to it.
 */
let suppressed = 0;

export function mobileFollowerSuppressed(): boolean {
  return suppressed > 0;
}

export async function suppressMobileFollower<T>(
  run: () => T | Promise<T>,
): Promise<T> {
  suppressed += 1;
  try {
    return await run();
  } finally {
    // Let effects scheduled by the last state change observe the suppression.
    await tick();
    suppressed -= 1;
  }
}

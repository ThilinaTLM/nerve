import {
  mobileHistoryDepth,
  resolveMobileHistoryPop,
  type MobileForwardRoutes,
} from "./mobile-routes";
import {
  mobileNav,
  popMobileScreenTo,
  pushMobileScreen,
} from "./mobile-shell.svelte";

type EntryState = { nerveMobileDepth: number };

/** The stack depth recorded on the current history entry; 0 outside the shell. */
function currentEntryDepth(): number {
  const state = history.state as Partial<EntryState> | null;
  const depth = state?.nerveMobileDepth;
  return typeof depth === "number" && Number.isInteger(depth) && depth > 0
    ? depth
    : 0;
}

/**
 * Route the system back and forward gestures (Android back, iOS edge swipes,
 * the browser buttons) into the phone route stack.
 *
 * The shell owns one history entry per route in the active tab's stack, each
 * stamped with its depth, so a pop is resolved from where the browser landed
 * rather than assumed to be Back. Routes popped by Back are kept so Forward
 * restores them; any in-app navigation discards them, as the browser does its
 * forward entries. Must be called during component initialisation so it only
 * exists while the phone shell is mounted.
 */
export function followMobileHistory(): void {
  // After a reload the restored stack reuses the entries already in history.
  let depth = currentEntryDepth();
  let forward: MobileForwardRoutes | undefined;

  $effect(() => {
    const onPopState = () => {
      const pop = resolveMobileHistoryPop({
        depth,
        reached: currentEntryDepth(),
        tab: mobileNav.tab,
        forward,
      });
      switch (pop.kind) {
        case "ignore":
          return;
        case "back": {
          const stack = mobileNav.stack;
          const keep = Math.max(0, stack.length - pop.count);
          forward = {
            tab: mobileNav.tab,
            routes: [
              ...stack.slice(keep),
              ...(forward?.tab === mobileNav.tab ? forward.routes : []),
            ],
          };
          // Update depth first so the sync effect sees nothing to do.
          depth -= pop.count;
          popMobileScreenTo(keep - 1);
          return;
        }
        case "forward":
          depth += pop.routes.length;
          forward = { tab: mobileNav.tab, routes: pop.remaining };
          for (const route of pop.routes) pushMobileScreen(route);
          return;
        case "rewind":
          history.go(-pop.count);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (depth > 0) history.go(-depth);
      depth = 0;
    };
  });

  $effect(() => {
    const target = mobileHistoryDepth(mobileNav.state);
    if (target === depth) return;
    // In-app navigation; the browser drops its forward entries on push too.
    forward = undefined;
    if (target > depth) {
      while (depth < target) {
        depth += 1;
        history.pushState({ nerveMobileDepth: depth } satisfies EntryState, "");
      }
    } else {
      const count = depth - target;
      depth = target;
      // The resulting pop lands on `depth` and is ignored.
      history.go(-count);
    }
  });
}

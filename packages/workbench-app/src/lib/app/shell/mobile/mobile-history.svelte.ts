import { mobileHistoryDepth } from "./mobile-routes";
import { backFromMobileScreen, mobileNav } from "./mobile-shell.svelte";

type EntryState = { nerveMobileDepth: number };

/** Entries the shell pushed before a reload are still in the session history. */
function currentEntryDepth(): number {
  const state = history.state as Partial<EntryState> | null;
  const depth = state?.nerveMobileDepth;
  return typeof depth === "number" && Number.isInteger(depth) && depth > 0
    ? depth
    : 0;
}

/**
 * Route the system back gesture (Android back, iOS edge swipe in a browser,
 * the browser back button) into the phone route stack.
 *
 * The shell owns one history entry per route in the active tab's stack, so
 * rapid repeated back gestures pop routes one by one and never leave the app
 * early. In-app navigation that shortens the stack rewinds the owned entries
 * silently. Must be called during component initialisation so it only exists
 * while the phone shell is mounted.
 */
export function followMobileHistory(): void {
  // After a reload the restored stack reuses the entries already in history.
  let depth = currentEntryDepth();
  let ignoredPops = 0;

  function rewind(count: number) {
    if (count <= 0) return;
    depth -= count;
    ignoredPops += 1;
    history.go(-count);
  }

  $effect(() => {
    const onPopState = () => {
      if (ignoredPops > 0) {
        ignoredPops -= 1;
        return;
      }
      if (depth === 0) return;
      depth -= 1;
      backFromMobileScreen();
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
    if (target > depth) {
      while (depth < target) {
        depth += 1;
        history.pushState({ nerveMobileDepth: depth } satisfies EntryState, "");
      }
    } else if (target < depth) {
      rewind(depth - target);
    }
  });
}

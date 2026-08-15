import type { CenterTabIdentity } from "./workspace-state.svelte";
import { mostRecentTab, tabIdentityKey } from "./tab-session-helpers";

function tabsEqual(
  left: CenterTabIdentity | undefined,
  right: CenterTabIdentity | undefined,
): boolean {
  return Boolean(
    left && right && left.kind === right.kind && left.id === right.id,
  );
}

export function planCenterTabClose(input: {
  openTabs: CenterTabIdentity[];
  activeTab?: CenterTabIdentity;
  mru: string[];
  closedTabs: CenterTabIdentity[];
  preferredFallback?: CenterTabIdentity;
}): {
  remainingTabs: CenterTabIdentity[];
  activeWasClosed: boolean;
  fallback?: CenterTabIdentity;
} {
  const closedKeys = new Set(input.closedTabs.map(tabIdentityKey));
  const remainingTabs = input.openTabs.filter(
    (tab) => !closedKeys.has(tabIdentityKey(tab)),
  );
  const activeWasClosed = Boolean(
    input.activeTab && closedKeys.has(tabIdentityKey(input.activeTab)),
  );
  const preferred = remainingTabs.find((tab) =>
    tabsEqual(tab, input.preferredFallback),
  );
  return {
    remainingTabs,
    activeWasClosed,
    fallback:
      preferred ?? mostRecentTab(remainingTabs, input.mru, input.closedTabs),
  };
}

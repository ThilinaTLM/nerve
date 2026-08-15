import type { CenterTabIdentity } from "./workspace-state.svelte";

export function activeCenterTabId<Kind extends CenterTabIdentity["kind"]>(
  active: CenterTabIdentity | undefined,
  kind: Kind,
): string | undefined {
  return active?.kind === kind ? active.id : undefined;
}

export function centerTabIds<Kind extends CenterTabIdentity["kind"]>(
  tabs: CenterTabIdentity[],
  kind: Kind,
): string[] {
  return tabs.flatMap((tab) => (tab.kind === kind ? [tab.id] : []));
}

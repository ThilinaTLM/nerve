import type { CenterTabIdentity } from "./workspace-state.svelte";

export function tabIdentityKey(tab: CenterTabIdentity): string {
  return `${tab.kind}:${tab.id}`;
}

export function startupTabActivationLane(
  tab: CenterTabIdentity | undefined,
): "critical" | "progressive" | "none" {
  if (!tab) return "none";
  return tab.kind === "conversation" ? "critical" : "progressive";
}

export function reorderTabs(
  tabs: CenterTabIdentity[],
  tab: CenterTabIdentity,
  targetIndex: number,
): CenterTabIdentity[] {
  const key = tabIdentityKey(tab);
  const sourceIndex = tabs.findIndex(
    (candidate) => tabIdentityKey(candidate) === key,
  );
  if (sourceIndex < 0) return tabs;
  const reordered = [...tabs];
  const [moved] = reordered.splice(sourceIndex, 1);
  const bounded = Math.max(0, Math.min(targetIndex, reordered.length));
  reordered.splice(bounded, 0, moved);
  return reordered;
}

export function mostRecentTab(
  tabs: CenterTabIdentity[],
  mru: string[],
  excluding: CenterTabIdentity[],
): CenterTabIdentity | undefined {
  const excluded = new Set(excluding.map(tabIdentityKey));
  const remaining = tabs.filter((tab) => !excluded.has(tabIdentityKey(tab)));
  for (const key of mru) {
    const tab = remaining.find(
      (candidate) => tabIdentityKey(candidate) === key,
    );
    if (tab) return tab;
  }
  return remaining[0];
}

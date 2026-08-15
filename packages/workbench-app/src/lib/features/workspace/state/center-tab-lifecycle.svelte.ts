import type { CenterTabIdentity } from "$lib/core/types/state-types";
import { notify } from "$lib/features/notifications/notify.svelte";
import { workspaceState } from "./workspace-state.svelte";
import { setActiveCenterTab } from "./center-tabs.svelte";

type CenterTabKind = CenterTabIdentity["kind"];
type CenterTabOfKind<Kind extends CenterTabKind> = Extract<
  CenterTabIdentity,
  { kind: Kind }
>;

export type CenterTabCloseContext = {
  remainingTabs: CenterTabIdentity[];
  fallback?: CenterTabIdentity;
  activeWasClosed: boolean;
};

type CenterTabLifecycle<Kind extends CenterTabKind> = {
  select: (tab: CenterTabOfKind<Kind>) => void | Promise<void>;
  dispose: (tab: CenterTabOfKind<Kind>) => void | Promise<void>;
  afterClose?: (
    tab: CenterTabOfKind<Kind>,
    context: CenterTabCloseContext,
  ) => void | Promise<void>;
};

export type CenterTabLifecycleMap = {
  [Kind in CenterTabKind]: CenterTabLifecycle<Kind>;
};

let lifecycles: CenterTabLifecycleMap | undefined;

export function registerCenterTabLifecycles(next: CenterTabLifecycleMap): void {
  lifecycles = next;
}

function lifecycleFor(
  tab: CenterTabIdentity,
): CenterTabLifecycle<CenterTabKind> {
  const lifecycle = lifecycles?.[tab.kind] as
    | CenterTabLifecycle<CenterTabKind>
    | undefined;
  if (!lifecycle) throw new Error(`No lifecycle for ${tab.kind} panes`);
  return lifecycle;
}

function reportCenterTabError(action: "switch" | "close", caught: unknown) {
  const message = caught instanceof Error ? caught.message : String(caught);
  workspaceState.error = message;
  notify.error(`Could not ${action} pane`, { description: message });
}

export async function selectCenterTab(
  tab: CenterTabIdentity | undefined,
): Promise<void> {
  if (!tab) {
    setActiveCenterTab(undefined);
    return;
  }
  try {
    await lifecycleFor(tab).select(tab);
  } catch (caught) {
    reportCenterTabError("switch", caught);
  }
}

export async function disposeCenterTab(
  tab: CenterTabIdentity,
): Promise<boolean> {
  try {
    await lifecycleFor(tab).dispose(tab);
    return true;
  } catch (caught) {
    reportCenterTabError("close", caught);
    return false;
  }
}

export async function notifyCenterTabClosed(
  tab: CenterTabIdentity,
  context: CenterTabCloseContext,
): Promise<void> {
  try {
    await lifecycleFor(tab).afterClose?.(tab, context);
  } catch (caught) {
    reportCenterTabError("close", caught);
  }
}

<script lang="ts">
import type { Snippet } from "svelte";
import { untrack } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import Activity from "@lucide/svelte/icons/activity";
import FolderKanban from "@lucide/svelte/icons/folder-kanban";
import Inbox from "@lucide/svelte/icons/inbox";
import {
  MobileLayer,
  MobileShell,
  type MobileTabModel,
} from "$lib/presentation/shell";
import { createWorkbenchGitPanelAdapter } from "$lib/features/git";
import { taskSelectors } from "$lib/features/tasks";
import { workspaceSelectors } from "$lib/application/workspace";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import MobileActivityHost from "./MobileActivityHost.svelte";
import MobileConversationDialogs from "./MobileConversationDialogs.svelte";
import MobileInboxHost from "./MobileInboxHost.svelte";
import MobileProjectsHost from "./MobileProjectsHost.svelte";
import MobileRouteHost from "./MobileRouteHost.svelte";
import { LIVE_TASK_STATUSES } from "./mobile-activity";
import { followMobileHistory } from "./mobile-history.svelte";
import { mobileInboxModel } from "./mobile-inbox-model.svelte";
import {
  activateMobileRoute,
  followMobileCenterTab,
} from "./mobile-route-activation.svelte";
import {
  MOBILE_TAB_IDS,
  isMobileTabId,
  mobileRouteKey,
  type MobileTabId,
} from "./mobile-routes";
import {
  mobileNav,
  pruneMobileNav,
  selectMobileTabId,
} from "./mobile-shell.svelte";

/**
 * The phone workbench: three root tabs, each with its own stack of full-screen
 * routes. Every route stays mounted while it is in a stack so going back keeps
 * scroll position and live conversation state; only the top route of the
 * active tab is visible.
 */
let { overlays }: { overlays?: Snippet } = $props();

followMobileCenterTab();
followMobileHistory();

const inbox = $derived(mobileInboxModel());
const anythingRunning = $derived(
  Object.values(workspaceSelectors.conversationActivityById).some(
    (activity) => activity?.busy,
  ) || taskSelectors.tasks.some((task) => LIVE_TASK_STATUSES.has(task.status)),
);

const tabs = $derived<MobileTabModel[]>([
  {
    id: "inbox",
    label: "Inbox",
    icon: Inbox,
    badge: inbox.needsYou.length,
  },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "activity", label: "Activity", icon: Activity, dot: anythingRunning },
]);

// Root screens mount on first visit and stay mounted.
const visited = new SvelteSet<MobileTabId>();
$effect(() => {
  visited.add(mobileNav.tab);
});

// Git data backs the project home summary and the repository screens, so it
// only polls while one of those is on screen.
const gitVisible = $derived(
  ["project", "git", "pull-requests", "branches"].includes(
    mobileNav.top?.kind ?? "",
  ),
);
const gitPanel = createWorkbenchGitPanelAdapter(
  () => workspaceSelectors.activeProject,
  () => gitVisible,
  () => gitVisible,
);

// A stack restored after a reload may point at projects or conversations that
// were deleted meanwhile; drop those routes once the workspace has loaded.
let restoredStackPruned = $state(false);
$effect(() => {
  const loaded =
    workbenchStartupState.coreReady || workbenchStartupState.phase === "failed";
  if (restoredStackPruned || !loaded) return;
  untrack(() => {
    pruneMobileNav({
      projectIds: new Set(workspaceSelectors.projects.map((p) => p.id)),
      conversationIds: new Set(
        workspaceSelectors.conversations.map((c) => c.id),
      ),
    });
    restoredStackPruned = true;
  });
});

// Whichever route surfaces — pushed, popped back to, or revealed by a tab
// switch — owns the shared project and center-tab selection.
const topKey = $derived(mobileNav.top ? mobileRouteKey(mobileNav.top) : "");
$effect(() => {
  if (!topKey || !restoredStackPruned) return;
  const route = untrack(() => mobileNav.top);
  if (route) void activateMobileRoute(route);
});

function selectTab(tab: string) {
  if (isMobileTabId(tab)) selectMobileTabId(tab);
}
</script>

<MobileShell
  {tabs}
  activeTab={mobileNav.tab}
  onSelectTab={selectTab}
  tabBarVisible={mobileNav.stack.length === 0}
  {overlays}
>
  {#each MOBILE_TAB_IDS as tab (tab)}
    {#if visited.has(tab)}
      {@const stack = mobileNav.state.stacks[tab]}
      {@const tabActive = tab === mobileNav.tab}
      <MobileLayer hidden={!tabActive || stack.length > 0}>
        {#if tab === "inbox"}
          <MobileInboxHost />
        {:else if tab === "projects"}
          <MobileProjectsHost />
        {:else}
          <MobileActivityHost />
        {/if}
      </MobileLayer>
      {#each stack as route, index (mobileRouteKey(route))}
        {@const visible = tabActive && index === stack.length - 1}
        <MobileLayer hidden={!visible}>
          <MobileRouteHost {route} {visible} {gitPanel} />
        </MobileLayer>
      {/each}
    {/if}
  {/each}
</MobileShell>

<MobileConversationDialogs />

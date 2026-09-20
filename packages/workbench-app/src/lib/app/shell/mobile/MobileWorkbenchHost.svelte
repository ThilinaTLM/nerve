<script lang="ts">
import type { Snippet } from "svelte";
import LayoutGrid from "@lucide/svelte/icons/layout-grid";
import Inbox from "@lucide/svelte/icons/inbox";
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import Menu from "@lucide/svelte/icons/menu";
import {
  MobileScreen,
  MobileShell,
  type MobileTabId,
  type MobileTabModel,
} from "$lib/presentation/shell";
import WorkbenchPanelHost from "$lib/app/composition/hosts/WorkbenchPanelHost.svelte";
import { panelViewDescriptors } from "$lib/app/composition/registries/panel-registry";
import { createWorkbenchGitPanelAdapter } from "$lib/features/git";
import { workspaceSelectors } from "$lib/application/workspace";
import { discoverTitlebarBadge } from "$lib/app/discover";
import MobileCenterHost from "./MobileCenterHost.svelte";
import MobileChatsHost from "./MobileChatsHost.svelte";
import MobileCodeHost from "./MobileCodeHost.svelte";
import MobileConversationDialogs from "./MobileConversationDialogs.svelte";
import MobileInboxHost from "./MobileInboxHost.svelte";
import MobileMoreHost from "./MobileMoreHost.svelte";
import MobileProjectsHost from "./MobileProjectsHost.svelte";
import { mobileInboxModel } from "./mobile-inbox-model.svelte";
import {
  backFromMobileDetail,
  mobileNav,
  selectMobileTabId,
  showMobileCenter,
} from "./mobile-shell.svelte";

let { overlays }: { overlays?: Snippet } = $props();

const inbox = $derived(mobileInboxModel());
const discoverBadge = $derived(discoverTitlebarBadge());

// Git data backs the Code tab summary as well as its panels, so it stays
// enabled while that tab is the one on screen.
const codeTabActive = $derived(mobileNav.tab === "code");
const gitPanel = createWorkbenchGitPanelAdapter(
  () => workspaceSelectors.activeProject,
  () => codeTabActive,
  () => codeTabActive,
);
const prCount = $derived(gitPanel.model.pullRequests.length);

const tabs = $derived<MobileTabModel[]>([
  {
    id: "inbox",
    label: "Inbox",
    icon: Inbox,
    badge: inbox.needsYou.length,
    dot: inbox.running.length > 0,
  },
  { id: "chats", label: "Chats", icon: MessagesSquare },
  // "Workspace", not "Project": the project is what the switcher selects; this
  // tab is the tooling inside the selected one.
  { id: "code", label: "Workspace", icon: LayoutGrid },
  {
    id: "more",
    label: "More",
    icon: Menu,
    dot: discoverBadge.kind !== "none",
  },
]);

const panelViewId = $derived(mobileNav.panelViewId);
// Panels render their own titled header, so the detail bar carries the project
// instead of repeating the panel name.
const panelTitle = $derived(
  workspaceSelectors.activeProject?.name ??
    panelViewDescriptors.find((descriptor) => descriptor.id === panelViewId)
      ?.title ??
    "Panel",
);

// Opening anything that lands in the center stack — a conversation from the
// inbox, a plan, settings from More — navigates to the detail screen.
let lastCenterKey: string | undefined;
let centerKeyInitialized = false;
$effect(() => {
  const active = workspaceSelectors.activeCenterTab;
  const key = active ? `${active.kind}:${active.id}` : undefined;
  if (!centerKeyInitialized) {
    centerKeyInitialized = true;
    lastCenterKey = key;
    return;
  }
  if (key === lastCenterKey) return;
  lastCenterKey = key;
  if (key) showMobileCenter();
});
</script>

<MobileShell
  {tabs}
  activeTab={mobileNav.tab}
  onSelectTab={selectMobileTabId}
  centerVisible={mobileNav.centerVisible}
  panelVisible={Boolean(panelViewId)}
  projectsVisible={mobileNav.projectsVisible}
  {overlays}
>
  {#snippet root(tab: MobileTabId)}
    {#if tab === "inbox"}
      <MobileInboxHost />
    {:else if tab === "chats"}
      <MobileChatsHost />
    {:else if tab === "code"}
      <MobileCodeHost {prCount} />
    {:else}
      <MobileMoreHost />
    {/if}
  {/snippet}

  {#snippet center()}
    <MobileCenterHost />
  {/snippet}

  {#snippet projects()}
    <MobileProjectsHost />
  {/snippet}

  {#snippet panel()}
    {#if panelViewId}
      <MobileScreen
        title={panelTitle}
        onBack={backFromMobileDetail}
        backLabel="Back to project"
        scroll={false}
      >
        <WorkbenchPanelHost
          viewId={panelViewId}
          gitModel={gitPanel.model}
          gitActions={gitPanel.actions}
        />
      </MobileScreen>
    {/if}
  {/snippet}
</MobileShell>

<MobileConversationDialogs />

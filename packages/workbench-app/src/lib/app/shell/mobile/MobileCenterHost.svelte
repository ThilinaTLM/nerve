<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { MobileScreen } from "$lib/presentation/shell";
import WorkbenchEditorHost from "$lib/app/shell/WorkbenchEditorHost.svelte";
import { tabIdentity, tabLabel } from "$lib/app/shell/editor-tab-helpers";
import {
  newConversation,
  workspaceSelectors,
} from "$lib/application/workspace";
import { backFromMobileDetail } from "./mobile-shell.svelte";

/**
 * The center stack as a phone detail screen: the header replaces the tab strip
 * so the transcript and composer keep the full viewport.
 */
const activeTab = $derived(workspaceSelectors.activeCenterTab);
const activeModel = $derived.by(() => {
  const active = activeTab;
  if (!active) return undefined;
  return workspaceSelectors.centerTabs.find((tab) => {
    const identity = tabIdentity(tab);
    return identity.kind === active.kind && identity.id === active.id;
  });
});
const title = $derived(activeModel ? tabLabel(activeModel) : "Nerve");
const project = $derived(workspaceSelectors.activeProject?.name);
</script>

<MobileScreen
  {title}
  subtitle={project}
  onBack={backFromMobileDetail}
  backLabel="Back to list"
  scroll={false}
>
  {#snippet actions()}
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="New chat"
      onclick={() => void newConversation()}
    >
      <Plus size={18} strokeWidth={2.1} />
    </Button>
  {/snippet}
  <WorkbenchEditorHost hideTabStrip />
</MobileScreen>

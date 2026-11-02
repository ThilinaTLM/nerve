<script lang="ts">
import type { Snippet } from "svelte";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { MobileActionSheet, MobileFab } from "$lib/presentation/shell";
import { workspaceSelectors, workspaceState } from "$lib/application/workspace";
import { startMobileConversation } from "./mobile-route-activation.svelte";

/**
 * Wraps a phone screen with the floating "New chat" pill. The chat starts in
 * the given project, else the active one; with no project at all the pill
 * opens the project picker first.
 */
let {
  project,
  children,
}: {
  project?: { id: string; directory: string; name?: string };
  children: Snippet;
} = $props();

const RECENT_PROJECT_LIMIT = 8;

let pickerOpen = $state(false);

const target = $derived(project ?? workspaceSelectors.activeProject);

const pickerItems = $derived.by((): ContextMenuItem[] => {
  const recent = workspaceSelectors.projectSwitcherItems
    .slice(0, RECENT_PROJECT_LIMIT)
    .map(
      (item): ContextMenuItem => ({
        label: item.project.name,
        onSelect: () => void startMobileConversation(item.project),
      }),
    );
  return [
    ...recent,
    { type: "separator" },
    {
      label: "Open folder",
      icon: FolderOpen,
      onSelect: () => {
        workspaceState.projectPickerPath = undefined;
        workspaceState.projectPickerOpen = true;
      },
    },
  ];
});

function newChat() {
  if (target) {
    void startMobileConversation(target);
    return;
  }
  pickerOpen = true;
}
</script>

<MobileFab
  label="New chat"
  ariaLabel={target?.name ? `New chat in ${target.name}` : "New chat"}
  onclick={newChat}
>
  {@render children()}
</MobileFab>

<MobileActionSheet
  open={pickerOpen}
  title="New chat in project"
  items={pickerItems}
  onOpenChange={(open) => (pickerOpen = open)}
/>

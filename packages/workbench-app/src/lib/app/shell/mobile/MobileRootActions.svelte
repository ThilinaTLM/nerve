<script lang="ts">
import FolderSearch from "@lucide/svelte/icons/folder-search";
import Plus from "@lucide/svelte/icons/plus";
import Settings from "@lucide/svelte/icons/settings";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { MobileActionSheet } from "$lib/presentation/shell";
import { workspaceSelectors, workspaceState } from "$lib/application/workspace";
import { discoverTitlebarBadge } from "$lib/app/discover";
import { startMobileConversation } from "./mobile-route-activation.svelte";
import { pushMobileScreen } from "./mobile-shell.svelte";

/**
 * Header actions shared by the root screens: start a chat anywhere and reach
 * settings without spending a tab on them. A project screen passes its own
 * project so "New chat" skips the picker.
 */
let {
  project,
}: {
  project?: { id: string; directory: string };
} = $props();

const RECENT_PROJECT_LIMIT = 8;

let pickerOpen = $state(false);
// Discover lives under Settings on the phone, so its attention badge does too.
const discoverBadge = $derived(discoverTitlebarBadge());

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
      label: "Browse for a project",
      icon: FolderSearch,
      onSelect: () => {
        workspaceState.projectPickerMode = "browse";
        workspaceState.projectPickerOpen = true;
      },
    },
  ];
});

function newChat() {
  if (project) {
    void startMobileConversation(project);
    return;
  }
  pickerOpen = true;
}
</script>

<Button variant="ghost" size="icon-sm" ariaLabel="New chat" onclick={newChat}>
  <Plus size={18} strokeWidth={2.1} />
</Button>
<Button
  variant="ghost"
  size="icon-sm"
  ariaLabel={discoverBadge.kind === "count"
    ? `Settings, ${discoverBadge.value} new`
    : "Settings"}
  onclick={() => pushMobileScreen({ kind: "settings" })}
>
  <span class="relative inline-flex">
    <Settings size={18} strokeWidth={1.9} />
    {#if discoverBadge.kind === "count"}
      <span
        class="absolute -right-2 -top-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-warning px-1 text-xs font-medium text-warning-foreground"
        aria-hidden="true"
        >{discoverBadge.value > 99 ? "99+" : discoverBadge.value}</span
      >
    {:else if discoverBadge.kind === "dot"}
      <span
        class="absolute -right-1 -top-0.5 size-2 rounded-full bg-info"
        aria-hidden="true"
      ></span>
    {/if}
  </span>
</Button>

{#if !project}
  <MobileActionSheet
    open={pickerOpen}
    title="New chat in…"
    items={pickerItems}
    onOpenChange={(open) => (pickerOpen = open)}
  />
{/if}

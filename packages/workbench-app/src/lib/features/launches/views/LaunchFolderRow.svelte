<script lang="ts">
import Folder from "@lucide/svelte/icons/folder";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { PanelRow } from "$lib/presentation/panels";

let {
  label,
  expanded,
  depth = 0,
  position,
  setSize,
  tabindex,
  activeCount = 0,
  folderId,
  menuItems = [],
  onToggle,
}: {
  label: string;
  expanded: boolean;
  depth?: number;
  position?: number;
  setSize?: number;
  tabindex?: number;
  /** Active runs below this folder. */
  activeCount?: number;
  folderId: string;
  menuItems?: ContextMenuItem[];
  onToggle?: () => void;
} = $props();
</script>

<PanelRow
  {label}
  {menuItems}
  indent={depth}
  role="treeitem"
  ariaExpanded={expanded}
  ariaLevel={depth + 1}
  ariaPosInSet={position}
  ariaSetSize={setSize}
  {tabindex}
  contentTabindex={tabindex === undefined ? undefined : -1}
  dataId={`folder:${folderId}`}
  onclick={() => onToggle?.()}
>
  {#snippet leading()}
    {#if expanded}
      <FolderOpen class="size-3.5" aria-hidden="true" />
    {:else}
      <Folder class="size-3.5" aria-hidden="true" />
    {/if}
  {/snippet}
  {#snippet badges()}
    {#if activeCount > 0}
      <Badge
        variant="accent"
        title={`${activeCount} active ${activeCount === 1 ? "run" : "runs"}`}
        aria-label={`${activeCount} active ${activeCount === 1 ? "run" : "runs"}`}
        >{activeCount}</Badge
      >
    {/if}
  {/snippet}
</PanelRow>

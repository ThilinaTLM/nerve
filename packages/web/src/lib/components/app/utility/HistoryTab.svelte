<script lang="ts">
  import ArrowRight from "lucide-svelte/icons/arrow-right";
  import Copy from "lucide-svelte/icons/copy";
  import GitBranch from "lucide-svelte/icons/git-branch";
  import Sparkles from "lucide-svelte/icons/sparkles";
  import { toast } from "svelte-sonner";
  import type { SessionRecord, SessionTreeNode } from "../../../api";
  import Button from "../../ui/Button.svelte";
  import ContextMenu, { type ContextMenuItem } from "../../ui/ContextMenu.svelte";

  type Props = {
    activeSession?: SessionRecord;
    treeNodes?: SessionTreeNode[];
    onNavigateToEntry?: (entryId: string | undefined, summarize?: boolean) => void;
    onCompact?: () => void;
  };

  let {
    activeSession,
    treeNodes = [],
    onNavigateToEntry,
    onCompact,
  }: Props = $props();

  function entryMenu(node: SessionTreeNode): ContextMenuItem[] {
    return [
      { label: "Jump here", icon: ArrowRight, onSelect: () => onNavigateToEntry?.(node.entry.id) },
      { label: "Jump + summarize from here", icon: Sparkles, onSelect: () => onNavigateToEntry?.(node.entry.id, true) },
      { type: "separator" },
      {
        label: "Copy entry id",
        icon: Copy,
        onSelect: async () => {
          try {
            await navigator.clipboard?.writeText(node.entry.id);
            toast.success("Copied entry id");
          } catch {
            toast.error("Could not copy to clipboard");
          }
        },
      },
    ];
  }
</script>

<header class="section-head">
  <div><GitBranch size={14} strokeWidth={2.2} /><strong>Branch History</strong></div>
  <div class="row-actions">
    <Button size="sm" variant="ghost" onclick={onCompact} disabled={!activeSession}>Compact</Button>
    <Button size="sm" variant="ghost" onclick={() => onNavigateToEntry?.(undefined)} disabled={!activeSession}>Root</Button>
  </div>
</header>

{#if treeNodes.length}
  <div class="row-list tree-list">
    {#each treeNodes as node, index}
      <ContextMenu items={entryMenu(node)}>
        <button
          class="utility-row tree-row"
          class:active={node.entry.id === activeSession?.activeEntryId}
          type="button"
          onclick={() => onNavigateToEntry?.(node.entry.id)}
        >
          <span class="tree-index">{String(index + 1).padStart(2, "0")}</span>
          <div>
            <strong>{node.entry.role} · {node.entry.kind}</strong>
            <span>{node.entry.text.slice(0, 120) || "empty entry"}</span>
          </div>
        </button>
      </ContextMenu>
    {/each}
  </div>
{:else}
  <p class="muted">No conversation history loaded.</p>
{/if}

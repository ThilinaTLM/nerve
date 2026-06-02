<script lang="ts">
  import GitBranch from "lucide-svelte/icons/git-branch";
  import type { SessionRecord, SessionTreeNode } from "../../../api";
  import Button from "../../ui/Button.svelte";

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
    {/each}
  </div>
{:else}
  <p class="muted">No conversation history loaded.</p>
{/if}

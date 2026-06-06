<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Copy from "@lucide/svelte/icons/copy";
  import CornerDownRight from "@lucide/svelte/icons/corner-down-right";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import { toast } from "svelte-sonner";
  import type { ConversationRecord, ConversationTreeNode } from "../../../api";
  import { Button } from "$lib/components/ui/button";
  import ConfirmDialog from "$lib/components/ui/confirm-dialog";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ui/context-menu-list";

  type Props = {
    activeConversation?: ConversationRecord;
    treeNodes?: ConversationTreeNode[];
    onNavigateToEntry?: (entryId: string | undefined, summarize?: boolean) => void;
    onCompact?: () => void;
  };

  let {
    activeConversation,
    treeNodes = [],
    onNavigateToEntry,
    onCompact,
  }: Props = $props();

  type TreeRow = {
    node: ConversationTreeNode;
    depth: number;
    index: number;
  };

  // DFS flatten. Depth only increases past a *branch point* (a node with more
  // than one child), so a purely linear history renders flat (depth 0) and only
  // genuine branches are indented as a tree.
  const rows = $derived.by<TreeRow[]>(() => {
    const byId = new Map(treeNodes.map((node) => [node.entry.id, node]));
    const hasParent = (node: ConversationTreeNode) =>
      node.entry.parentEntryId !== undefined && byId.has(node.entry.parentEntryId);
    const roots = treeNodes.filter((node) => !hasParent(node));
    const out: TreeRow[] = [];
    const visited = new Set<string>();
    let index = 0;
    const walk = (node: ConversationTreeNode, depth: number) => {
      if (visited.has(node.entry.id)) return;
      visited.add(node.entry.id);
      out.push({ node, depth, index: ++index });
      const children = node.childEntryIds
        .map((id) => byId.get(id))
        .filter((child): child is ConversationTreeNode => Boolean(child));
      const childDepth = children.length > 1 ? depth + 1 : depth;
      for (const child of children) walk(child, childDepth);
    };
    const rootDepth = roots.length > 1 ? 1 : 0;
    for (const root of roots) walk(root, rootDepth);
    for (const node of treeNodes) if (!visited.has(node.entry.id)) walk(node, 0);
    return out;
  });

  let confirmCompactOpen = $state(false);

  function entryMenu(node: ConversationTreeNode): ContextMenuItem[] {
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

<div class="flex flex-col gap-1 p-2">
  <div class="flex items-center justify-end gap-1.5 pb-1">
    <Button size="sm" variant="outline" onclick={() => onNavigateToEntry?.(undefined)} disabled={!activeConversation}>
      Root
    </Button>
    <Button size="sm" variant="outline" onclick={() => (confirmCompactOpen = true)} disabled={!activeConversation}>
      Compact
    </Button>
  </div>

  {#if rows.length}
    <div class="flex flex-col gap-0.5">
      {#each rows as row (row.node.entry.id)}
        <ContextMenu items={entryMenu(row.node)} triggerClass="block w-full min-w-0">
          <button
            class="relative flex w-full items-start gap-2 rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-muted/60 data-[active=true]:bg-muted/70"
            data-active={row.node.entry.id === activeConversation?.activeEntryId}
            style={`padding-left: ${0.5 + row.depth * 0.95}rem`}
            type="button"
            onclick={() => onNavigateToEntry?.(row.node.entry.id)}
          >
            {#if row.node.entry.id === activeConversation?.activeEntryId}
              <span class="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" aria-hidden="true"></span>
            {/if}
            {#if row.depth > 0}
              <CornerDownRight class="mt-0.5 size-3 shrink-0 text-muted-foreground/50" strokeWidth={2} />
            {/if}
            <span class="mt-px font-mono text-xs text-muted-foreground/60">
              {String(row.index).padStart(2, "0")}
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-xs font-medium text-foreground">
                {row.node.entry.role} · {row.node.entry.kind}
              </div>
              <div class="truncate font-mono text-xs text-muted-foreground">
                {row.node.entry.text.slice(0, 120) || "empty entry"}
              </div>
            </div>
          </button>
        </ContextMenu>
      {/each}
    </div>
  {:else}
    <p class="px-1 py-6 text-center text-xs text-muted-foreground">No conversation history loaded.</p>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmCompactOpen}
  title="Compact conversation"
  description="This summarizes earlier messages to reduce context size. The full history stays available in the branch tree."
  confirmLabel="Compact"
  onConfirm={() => onCompact?.()}
/>

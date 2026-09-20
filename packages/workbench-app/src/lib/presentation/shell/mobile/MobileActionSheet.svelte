<script lang="ts">
import * as Sheet from "@nervekit/ui-kit/components/ui/sheet";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";

/**
 * Phone replacement for a right-click menu: the same `ContextMenuItem` model
 * the desktop menus use, rendered as a bottom sheet with full-width targets.
 * Submenus flatten into labelled groups because a phone has no hover affordance
 * to open them.
 */
let {
  open = false,
  title,
  items,
  onOpenChange,
}: {
  open?: boolean;
  title: string;
  items: ContextMenuItem[];
  onOpenChange: (open: boolean) => void;
} = $props();

type MenuAction = Extract<ContextMenuItem, { type?: "item" }>;

type FlatEntry =
  | { kind: "action"; item: MenuAction }
  | { kind: "label"; label: string }
  | { kind: "separator"; id: string };

const entries = $derived.by(() => {
  const flat: FlatEntry[] = [];
  let separatorId = 0;
  const push = (list: ContextMenuItem[]) => {
    for (const item of list) {
      if (item.type === "separator") {
        flat.push({ kind: "separator", id: `separator-${separatorId++}` });
        continue;
      }
      if (item.type === "label") {
        flat.push({ kind: "label", label: item.label });
        continue;
      }
      if (item.type === "submenu") {
        flat.push({ kind: "separator", id: `separator-${separatorId++}` });
        flat.push({ kind: "label", label: item.label });
        push(item.items);
        continue;
      }
      flat.push({ kind: "action", item });
    }
  };
  push(items);
  // Trailing and leading separators are noise once the list is flat.
  while (flat[0]?.kind === "separator") flat.shift();
  while (flat.at(-1)?.kind === "separator") flat.pop();
  return flat;
});

function select(item: MenuAction) {
  if (item.disabled) return;
  onOpenChange(false);
  item.onSelect?.();
}
</script>

<Sheet.Root {open} {onOpenChange}>
  <Sheet.Content
    side="bottom"
    class="rounded-t-lg pb-[env(safe-area-inset-bottom)]"
    swipeToDismiss
    onSwipeDismiss={() => onOpenChange(false)}
  >
    <Sheet.Title class="truncate px-4 pb-1 pt-3 text-sm font-semibold"
      >{title}</Sheet.Title
    >
    <div class="action-sheet-list">
      {#each entries as entry, index (entry.kind === "separator" ? entry.id : `${entry.kind}-${index}`)}
        {#if entry.kind === "separator"}
          <span class="my-1 block h-px bg-border" aria-hidden="true"></span>
        {:else if entry.kind === "label"}
          <span class="block px-4 pb-1 pt-2 text-xs text-muted-foreground"
            >{entry.label}</span
          >
        {:else}
          {@const Icon = entry.item.icon}
          <button
            type="button"
            class="action-sheet-item"
            class:destructive={entry.item.destructive}
            disabled={entry.item.disabled}
            onclick={() => select(entry.item)}
          >
            {#if Icon}
              <Icon size={18} strokeWidth={1.9} />
            {:else}
              <span class="size-[18px]" aria-hidden="true"></span>
            {/if}
            <span class="min-w-0 flex-1 truncate text-left">
              {entry.item.label}
            </span>
          </button>
        {/if}
      {/each}
    </div>
  </Sheet.Content>
</Sheet.Root>

<style>
.action-sheet-list {
  overflow-y: auto;
  padding-bottom: 0.5rem;
}

.action-sheet-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  min-height: 2.75rem;
  padding: 0 1rem;
  color: var(--foreground);
  font-size: var(--text-sm);
}

.action-sheet-item:active {
  background: var(--accent);
}

.action-sheet-item.destructive {
  color: var(--destructive);
}

.action-sheet-item:disabled {
  color: var(--muted-foreground);
}
</style>

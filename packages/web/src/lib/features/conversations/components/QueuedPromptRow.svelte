<script lang="ts">
  import ListPlus from "@lucide/svelte/icons/list-plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import type { QueuedPromptRecord } from "$lib/api";
  import ContextMenu, {
    type ContextMenuItem,
  } from "@nervekit/ui/components/ui/context-menu-list";
  import PlainText from "@nervekit/ui/core/components/PlainText.svelte";

  type Props = {
    prompt: QueuedPromptRecord;
    onDiscard?: (prompt: QueuedPromptRecord) => void | Promise<void>;
    onMoveToComposer?: (prompt: QueuedPromptRecord) => void | Promise<void>;
  };

  let { prompt, onDiscard, onMoveToComposer }: Props = $props();

  const menuItems = $derived<ContextMenuItem[]>([
    {
      label: "Cancel & Edit",
      icon: Undo2,
      disabled: !onMoveToComposer,
      onSelect: () => void onMoveToComposer?.(prompt),
    },
    { type: "separator" },
    {
      label: "Discard",
      icon: Trash2,
      destructive: true,
      disabled: !onDiscard,
      onSelect: () => void onDiscard?.(prompt),
    },
  ]);
</script>

<ContextMenu items={menuItems} triggerClass="block select-text">
  <article class="queued-prompt-card" aria-label="Queued user prompt">
    <div class="queued-badge" title="This prompt is queued for the next agent turn">
      <ListPlus size={13} strokeWidth={2.2} aria-hidden="true" />
      <span>Queued</span>
    </div>
    <div class="queued-content">
      <PlainText text={prompt.text} />
    </div>
  </article>
</ContextMenu>

<style>
  .queued-prompt-card {
    width: fit-content;
    max-width: 70%;
    margin-left: auto;
    border: 1px dashed color-mix(in oklab, var(--muted-foreground) 28%, var(--border));
    border-radius: var(--radius-lg);
    border-bottom-right-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--muted) 72%, var(--card));
    padding: 0.55rem 0.8rem 0.65rem;
    color: var(--muted-foreground);
  }

  .queued-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 0.4rem;
    border: 1px solid color-mix(in oklab, var(--muted-foreground) 18%, var(--border));
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--card) 72%, var(--muted));
    padding: 0.14rem 0.42rem;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1.2;
  }

  .queued-content {
    min-width: 0;
    color: color-mix(in oklab, var(--foreground) 78%, var(--muted-foreground));
    font-size: var(--text-sm);
  }
</style>

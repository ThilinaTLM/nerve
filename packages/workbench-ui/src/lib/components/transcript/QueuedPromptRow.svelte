<script lang="ts">
import ListPlus from "@lucide/svelte/icons/list-plus";
import Pencil from "@lucide/svelte/icons/pencil";
import Trash2 from "@lucide/svelte/icons/trash-2";
import Undo2 from "@lucide/svelte/icons/undo-2";
import type { QueuedPromptRecord } from "../../state/tool-types";
import ContextMenu, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/ui/context-menu-list";
import PlainText from "@nervekit/ui-kit/core/components/PlainText.svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";

type Props = {
  prompt: QueuedPromptRecord;
  onDiscard?: (prompt: QueuedPromptRecord) => void | Promise<void>;
  onMoveToComposer?: (prompt: QueuedPromptRecord) => void | Promise<void>;
};

let { prompt, onDiscard, onMoveToComposer }: Props = $props();
let pendingAction = $state<"edit" | "discard" | undefined>();

async function runAction(action: "edit" | "discard") {
  if (pendingAction) return;
  pendingAction = action;
  try {
    if (action === "edit") await onMoveToComposer?.(prompt);
    else await onDiscard?.(prompt);
  } catch {
    // Host actions own user-facing error reporting.
  } finally {
    pendingAction = undefined;
  }
}

const menuItems = $derived<ContextMenuItem[]>([
  {
    label: "Cancel & Edit",
    icon: Undo2,
    disabled: !onMoveToComposer || Boolean(pendingAction),
    onSelect: () => void runAction("edit"),
  },
  { type: "separator" },
  {
    label: "Discard",
    icon: Trash2,
    destructive: true,
    disabled: !onDiscard || Boolean(pendingAction),
    onSelect: () => void runAction("discard"),
  },
]);
</script>

<ContextMenu items={menuItems} triggerClass="block select-text">
  <article class="queued-prompt-card" aria-label="Queued user prompt">
    <div
      class="queued-badge"
      title="This prompt is queued for the next agent turn"
    >
      <ListPlus size={13} strokeWidth={2.2} aria-hidden="true" />
      <span>Queued</span>
    </div>
    <div class="queued-actions" role="group" aria-label="Queued prompt actions">
      <Tooltip.Provider delayDuration={300} disableHoverableContent>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon-xs"
                disabled={!onMoveToComposer || Boolean(pendingAction)}
                ariaLabel="Cancel and edit queued prompt"
                onclick={() => void runAction("edit")}
              >
                <Pencil aria-hidden="true" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content sideOffset={4}>Cancel & Edit</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon-xs"
                disabled={!onDiscard || Boolean(pendingAction)}
                ariaLabel="Discard queued prompt"
                onclick={() => void runAction("discard")}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content sideOffset={4}>Discard</Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
    </div>
    <div class="queued-content">
      <PlainText text={prompt.text} />
    </div>
  </article>
</ContextMenu>

<style>
.queued-prompt-card {
  position: relative;
  width: fit-content;
  max-width: 70%;
  margin-left: auto;
  border: 1px dashed
    color-mix(in oklab, var(--muted-foreground) 28%, var(--border));
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
  border: 1px solid
    color-mix(in oklab, var(--muted-foreground) 18%, var(--border));
  border-radius: var(--radius-sm);
  background: color-mix(in oklab, var(--card) 72%, var(--muted));
  padding: 0.14rem 0.42rem;
  color: var(--muted-foreground);
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1.2;
}

.queued-actions {
  position: absolute;
  top: 0.35rem;
  right: 0.35rem;
  display: flex;
  gap: 0.1rem;
  opacity: 0;
  pointer-events: none;
  transform: translateY(0.12rem);
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}

.queued-prompt-card:hover .queued-actions,
.queued-prompt-card:focus-within .queued-actions {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.queued-content {
  min-width: 0;
  color: color-mix(in oklab, var(--foreground) 78%, var(--muted-foreground));
  font-size: var(--text-sm);
}

@container (max-width: 40rem) {
  .queued-prompt-card {
    max-width: 88%;
  }
}

@media (hover: none) {
  .queued-actions {
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }
}
</style>

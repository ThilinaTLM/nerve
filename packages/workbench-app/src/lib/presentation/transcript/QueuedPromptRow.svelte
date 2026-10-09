<script lang="ts">
import ArrowUpToLine from "@lucide/svelte/icons/arrow-up-to-line";
import ListPlus from "@lucide/svelte/icons/list-plus";
import Pencil from "@lucide/svelte/icons/pencil";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { QueuedInput } from "@nervekit/contracts/core";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import UserMessageContent from "./UserMessageContent.svelte";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";

type Props = {
  prompt: QueuedInput;
  queueError?: string;
  onForcePush?: (prompt: QueuedInput) => void | Promise<void>;
  onDiscard?: (prompt: QueuedInput) => void | Promise<void>;
  onMoveToComposer?: (prompt: QueuedInput) => void | Promise<void>;
};

let { prompt, queueError, onForcePush, onDiscard, onMoveToComposer }: Props =
  $props();
let pendingAction = $state<"force-push" | "edit" | "discard" | undefined>();

async function runAction(action: "force-push" | "edit" | "discard") {
  if (pendingAction) return;
  pendingAction = action;
  try {
    if (action === "force-push") await onForcePush?.(prompt);
    else if (action === "edit") await onMoveToComposer?.(prompt);
    else await onDiscard?.(prompt);
  } catch {
    // Host actions own user-facing error reporting.
  } finally {
    pendingAction = undefined;
  }
}

const interruptionPending = false;
const editable = $derived(typeof prompt.content === "string");
const label = $derived(
  prompt.source === "system" ? "Queued notice" : "Queued prompt",
);
</script>

<article
  class="ml-auto w-fit max-w-full rounded-lg border border-dashed bg-card p-3 text-muted-foreground"
  data-input-id={prompt.inputId}
  aria-label={prompt.source === "system"
    ? "Queued system input"
    : "Queued user prompt"}
>
  <div
    class="flex flex-wrap items-center gap-1 pb-2 text-xs font-semibold"
    title={`${prompt.inputId} · ${label}`}
  >
    <ListPlus size={13} strokeWidth={2.2} aria-hidden="true" />
    <span>{label}</span>
    {#if queueError}
      <span class="text-warning" title={queueError}>Last known queue</span>
    {/if}
  </div>
  <div class="min-w-0 text-sm text-foreground">
    <UserMessageContent
      text={typeof prompt.content === "string"
        ? prompt.content
        : prompt.content.text}
    />
  </div>
  <div
    class="flex justify-end gap-1 pt-2"
    role="group"
    aria-label="Queued prompt actions"
  >
    <Tooltip.Provider delayDuration={300} disableHoverableContent>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-xs"
              disabled={!onForcePush ||
                Boolean(pendingAction) ||
                interruptionPending}
              ariaLabel="Force push all queued prompts"
              onclick={() => void runAction("force-push")}
            >
              <ArrowUpToLine aria-hidden="true" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content sideOffset={4}>
          Force push all queued prompts
        </Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-xs"
              disabled={!editable ||
                !onMoveToComposer ||
                Boolean(pendingAction)}
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
</article>

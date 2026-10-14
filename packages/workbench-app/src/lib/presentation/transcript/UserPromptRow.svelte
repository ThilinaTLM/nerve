<script lang="ts">
import ArrowUpToLine from "@lucide/svelte/icons/arrow-up-to-line";
import Pencil from "@lucide/svelte/icons/pencil";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { QueuedPromptRecord } from "../state/tool-types";
import type { ConversationMenuBuilders } from "../conversations/conversation-view-contracts.js";
import TranscriptContextMenu from "./TranscriptContextMenu.svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import UserMessageBubble from "./UserMessageBubble.svelte";
import type { TimelineMessageItem } from "./transcript-presentation";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";

// One row owns both queued input and delivered message presentation. Keeping
// this component mounted preserves the bubble and command content on delivery.
type Props = {
  prompt?: QueuedPromptRecord;
  item?: TimelineMessageItem["item"];
  onForcePush?: (prompt: QueuedPromptRecord) => void | Promise<void>;
  onDiscard?: (prompt: QueuedPromptRecord) => void | Promise<void>;
  onMoveToComposer?: (prompt: QueuedPromptRecord) => void | Promise<void>;
  transcriptMenu: ConversationMenuBuilders["transcriptMenu"];
};

let {
  prompt,
  item,
  onForcePush,
  onDiscard,
  onMoveToComposer,
  transcriptMenu,
}: Props = $props();
let pendingAction = $state<"force-push" | "edit" | "discard" | undefined>();

async function runAction(action: "force-push" | "edit" | "discard") {
  if (pendingAction || !prompt) return;
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

const menuTarget = $derived(
  prompt
    ? {
        kind: "queued_prompt" as const,
        prompt,
        busy: Boolean(pendingAction),
        canForcePush: Boolean(onForcePush),
        canEdit: Boolean(onMoveToComposer),
        canDiscard: Boolean(onDiscard),
        onForcePush: () => void runAction("force-push"),
        onEdit: () => void runAction("edit"),
        onDiscard: () => void runAction("discard"),
      }
    : item
      ? { kind: "message" as const, item }
      : undefined,
);
</script>

{#if menuTarget}
  <TranscriptContextMenu
    target={menuTarget}
    menu={transcriptMenu}
    triggerClass="block select-text"
  >
    <UserMessageBubble
      text={prompt?.preparedText ??
        prompt?.text ??
        item?.preparedText ??
        item?.text ??
        ""}
      commandPreparation={prompt?.commandPreparation ??
        item?.commandPreparation}
      queued={Boolean(prompt && prompt.presentation !== "starting")}
      pending={Boolean(
        item?.optimistic && (!prompt || prompt.presentation === "starting"),
      )}
      showActions={Boolean(prompt)}
    >
      {#snippet actions()}
        <Tooltip.Provider delayDuration={300} disableHoverableContent>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="ghost"
                  size="icon-sm"
                  disabled={!prompt || !onForcePush || Boolean(pendingAction)}
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
                  size="icon-sm"
                  disabled={!prompt ||
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
                  size="icon-sm"
                  disabled={!prompt || !onDiscard || Boolean(pendingAction)}
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
      {/snippet}
      {#if item?.stopReason === "error" && item.errorMessage?.trim()}
        <pre
          class="mt-2 whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">{item.errorMessage.trim()}</pre>
      {/if}
    </UserMessageBubble>
  </TranscriptContextMenu>
{/if}

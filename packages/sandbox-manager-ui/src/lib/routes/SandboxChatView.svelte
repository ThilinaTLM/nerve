<script lang="ts">
  import { MessageSquareOff } from "@lucide/svelte";
  import { PromptComposer, TranscriptPane } from "@nervekit/conversation-ui";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import SelectField from "@nervekit/ui/components/ui/select-field";
  import type { SelectItem } from "@nervekit/ui/components/ui/select-field";

  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";


  let { record }: { record: ManagedSandboxRecord } = $props();

  const store = useSandboxManagerStore();
  const detail = $derived(store.details[record.sandboxId]);
  const richState = $derived(
    detail?.selectedConversationId
      ? detail.conversationViewsById[detail.selectedConversationId]
      : Object.values(detail?.conversationViewsById ?? {})[0],
  );
  const connected = $derived(detail?.status?.connected ?? false);

  const conversationItems = $derived<SelectItem[]>(
    (detail?.snapshot?.conversations ?? []).map((conversation) => ({
      value: conversation.conversationId,
      label: conversation.title ?? conversation.conversationId,
    })),
  );

  const activeRun = $derived(
    richState?.activeRun ??
      (detail?.selectedRunId ? detail.liveRuns[detail.selectedRunId] : undefined),
  );
  const canCancel = $derived(
    activeRun?.status === "running" || activeRun?.status === "queued" || activeRun?.status === "streaming",
  );
</script>

<div class="flex h-full flex-col">
  {#if conversationItems.length > 1 && detail}
    <div class="flex-none border-b p-2">
      <SelectField
        items={conversationItems}
        value={detail.selectedConversationId ?? ""}
        ariaLabel="Select conversation"
        class="max-w-xs"
        onValueChange={(value) => {
          if (detail) detail.selectedConversationId = value;
        }}
      />
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-hidden">
    {#if !richState || (richState.entries.length === 0 && !richState.activeRun)}
      <div class="mx-auto max-w-3xl p-4">
        <div class="flex flex-col items-center gap-2 py-16 text-center">
          <MessageSquareOff class="size-8 text-muted-foreground" />
          <p class="text-sm text-muted-foreground">
            {connected
              ? "No conversation yet. Send a prompt to start a run."
              : "No controller session connected. Chat is read-only until the sandbox reconnects."}
          </p>
        </div>
      </div>
    {:else}
      <TranscriptPane state={richState} />
    {/if}
  </div>

  {#if detail}
    <PromptComposer
      value={detail.composerText}
      disabled={!connected || detail.sending || Boolean(richState?.readOnly)}
      onSubmit={(text) => void store.sendPrompt(record.sandboxId, text)}
      onAbort={canCancel ? () => void store.cancelRun(record.sandboxId) : undefined}
    />
  {/if}
</div>

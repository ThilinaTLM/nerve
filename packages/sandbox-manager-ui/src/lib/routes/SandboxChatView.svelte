<script lang="ts">
  import { MessageSquareOff } from "@lucide/svelte";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { ScrollArea } from "@nervekit/ui/components/ui/scroll-area";
  import SelectField from "@nervekit/ui/components/ui/select-field";
  import type { SelectItem } from "@nervekit/ui/components/ui/select-field";
  import SandboxComposer from "../components/chat/SandboxComposer.svelte";
  import SandboxTranscript from "../components/chat/SandboxTranscript.svelte";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import { buildTimeline } from "../state/sandbox-snapshot-adapter";

  let { record }: { record: ManagedSandboxRecord } = $props();

  const store = useSandboxManagerStore();
  const detail = $derived(store.details[record.sandboxId]);
  const timeline = $derived(detail ? buildTimeline(detail) : []);
  const connected = $derived(detail?.status?.connected ?? false);

  const conversationItems = $derived<SelectItem[]>(
    (detail?.snapshot?.conversations ?? []).map((conversation) => ({
      value: conversation.conversationId,
      label: conversation.title ?? conversation.conversationId,
    })),
  );

  const activeRun = $derived(
    detail?.selectedRunId
      ? detail.liveRuns[detail.selectedRunId]
      : undefined,
  );
  const canCancel = $derived(
    activeRun?.status === "running" || activeRun?.status === "queued",
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

  <ScrollArea class="min-h-0 flex-1">
    <div class="mx-auto max-w-3xl p-4">
      {#if timeline.length === 0}
        <div class="flex flex-col items-center gap-2 py-16 text-center">
          <MessageSquareOff class="size-8 text-muted-foreground" />
          <p class="text-sm text-muted-foreground">
            {connected
              ? "No conversation yet. Send a prompt to start a run."
              : "No controller session connected. Chat is read-only until the sandbox reconnects."}
          </p>
        </div>
      {:else}
        <SandboxTranscript
          rows={timeline}
          onsubmitInput={(waitId, text) =>
            void store.submitInput(record.sandboxId, waitId, text)}
          onresolveApproval={(waitId, decision) =>
            void store.resolveApproval(record.sandboxId, waitId, decision)}
        />
      {/if}
    </div>
  </ScrollArea>

  {#if detail}
    <SandboxComposer
      bind:value={detail.composerText}
      sending={detail.sending}
      {canCancel}
      disabled={!connected}
      onsend={(text) => void store.sendPrompt(record.sandboxId, text)}
      oncancel={() => void store.cancelRun(record.sandboxId)}
    />
  {/if}
</div>

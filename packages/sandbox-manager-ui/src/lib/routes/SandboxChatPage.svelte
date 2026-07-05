<script lang="ts">
  import { ArrowLeft, MessageSquareOff } from "@lucide/svelte";
  import { PromptComposer, TranscriptList } from "@nervekit/conversation-ui";
  import { Button } from "@nervekit/ui/components/ui/button";
  import SelectField from "@nervekit/ui/components/ui/select-field";
  import type { SelectItem } from "@nervekit/ui/components/ui/select-field";
  import AppShell from "../components/layout/AppShell.svelte";
  import SandboxStatusBadge from "../components/SandboxStatusBadge.svelte";
  import { buildSandboxChatRender } from "../state/sandbox-chat-render";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import type { SandboxManagerRouteState } from "./route-state.svelte";

  let {
    route,
    sandboxId,
  }: { route: SandboxManagerRouteState; sandboxId: string } = $props();

  const store = useSandboxManagerStore();
  const record = $derived(
    store.sandboxes.find((item) => item.sandboxId === sandboxId),
  );
  const detail = $derived(store.details[sandboxId]);
  const richState = $derived(
    detail?.selectedConversationId
      ? detail.conversationViewsById[detail.selectedConversationId]
      : Object.values(detail?.conversationViewsById ?? {})[0],
  );
  const connected = $derived(detail?.status?.connected ?? false);
  const render = $derived(buildSandboxChatRender(richState));

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
    activeRun?.status === "running" ||
      activeRun?.status === "queued" ||
      activeRun?.status === "streaming",
  );
  const hasContent = $derived(
    render.timeline.length > 0 || Boolean(render.streamingText),
  );
</script>

<AppShell {route} contentVariant="full">
  <div class="flex flex-none flex-wrap items-center gap-3 border-b px-4 py-2.5">
    <Button variant="ghost" size="icon-sm" ariaLabel="Back to sandbox" onclick={() => route.openSandbox(sandboxId)}>
      <ArrowLeft class="size-4" />
    </Button>
    <div class="flex min-w-0 flex-col">
      <span class="truncate text-sm font-semibold">{record?.name ?? sandboxId}</span>
      <span class="truncate font-mono text-xs text-muted-foreground">{sandboxId}</span>
    </div>
    {#if record}<SandboxStatusBadge {record} />{/if}
    {#if conversationItems.length > 1 && detail}
      <div class="ml-auto">
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
  </div>

  <div class="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
    {#if !hasContent}
      <div class="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
        <MessageSquareOff class="size-8 text-muted-foreground" />
        <p class="text-sm text-muted-foreground">
          {connected
            ? "No conversation yet. Send a prompt to start a run."
            : "No controller session connected. Chat is read-only until the sandbox reconnects."}
        </p>
      </div>
    {:else}
      <div class="flex min-h-0 flex-1 flex-col" role="log" aria-label="Conversation transcript" aria-live="polite">
        <TranscriptList
          timeline={render.timeline}
          streamingText={render.streamingText}
          sending={detail?.sending ?? false}
          hasLiveTimelineNodes={render.hasLiveTimelineNodes}
          queuedPrompts={[]}
          paddingEnd={18}
          heightCacheKey={detail?.selectedConversationId}
          messageMenu={() => []}
          toolMenu={() => []}
        />
      </div>
    {/if}

    {#if detail}
      <PromptComposer
        value={detail.composerText}
        disabled={!connected || detail.sending || Boolean(richState?.readOnly)}
        onSubmit={(text) => void store.sendPrompt(sandboxId, text)}
        onAbort={canCancel ? () => void store.cancelRun(sandboxId) : undefined}
      />
    {/if}
  </div>
</AppShell>

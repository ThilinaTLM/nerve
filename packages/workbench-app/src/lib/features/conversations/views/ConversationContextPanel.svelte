<script lang="ts">
import type { ConversationStore } from "../state/core-conversation-store.svelte";
import { conversationContext } from "../adapters/core-context.adapter";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import type { ModelInfo } from "@nervekit/contracts/models";
import {
  PanelView,
  PanelHeader,
  PanelSectionHeader,
  PanelPropertyRow,
  PanelEmpty,
  PanelBanner,
} from "$lib/presentation/panels";
let { store }: { store?: ConversationStore } = $props();
let models = $state<ModelInfo[]>([]);
$effect(() => {
  const id = store?.conversationId;
  if (!id) {
    models = [];
    return;
  }
  let current = true;
  void requestConversation("model.list", {})
    .then((result) => {
      if (current) models = result.models;
    })
    .catch(() => {
      if (current) models = [];
    });
  return () => {
    current = false;
  };
});
const context = $derived(
  store?.snapshot
    ? conversationContext(store.snapshot, store.events)
    : undefined,
);
const contextWindow = $derived(
  models.find(
    (model) =>
      model.provider === context?.requestModel.provider &&
      model.modelId === context?.requestModel.modelId,
  )?.contextWindow ?? 0,
);
const requestUsage = $derived(
  context?.requestTokens === null || context?.requestTokens === undefined
    ? context?.compacted
      ? "Awaiting response after compaction"
      : "Unknown until first response"
    : `${context.requestTokens.toLocaleString()}${contextWindow > 0 ? ` / ${contextWindow.toLocaleString()} (${Math.round((context.requestTokens / contextWindow) * 100)}%)` : " tokens"}`,
);
</script>
<PanelView>
  {#snippet banner()}<PanelHeader title="Context" />{/snippet}
  {#if context}
    {#if store?.error}<PanelBanner tone="destructive">{store.error}</PanelBanner
      >{/if}
    <PanelSectionHeader title="Conversation" />
    <PanelPropertyRow label="Conversation" value={context.conversation.title} />
    <PanelPropertyRow
      label="Status"
      value={context.conversation.paused
        ? "Paused"
        : context.conversation.status}
    />
    <PanelPropertyRow label="Model" value={context.config.model.modelId} />
    <PanelPropertyRow label="Reasoning" value={context.config.reasoningLevel} />
    <PanelPropertyRow label="Mode" value={context.config.mode} />
    <PanelPropertyRow
      label="Permission rule set"
      value={context.config.permissionRuleSetId}
    />
    <PanelPropertyRow
      label="Working directory"
      value={context.config.workingDirectory}
    />
    <PanelSectionHeader title="Context window" />
    <PanelPropertyRow label="Last request" value={requestUsage} />
    {#if context.requestTokens !== null}<PanelPropertyRow
        label="Request model"
        value={context.requestModel.modelId}
      />{/if}
    <PanelPropertyRow
      label="Queued inputs"
      value={String(context.queuedCount)}
    />
    <PanelPropertyRow
      label="Open tool calls"
      value={String(context.openToolCount)}
    />
    <PanelPropertyRow
      label="Background commands"
      value={String(context.activeBashCount)}
    />
    <PanelSectionHeader
      title={store?.hasOlder ? "Loaded history usage" : "History usage"}
    />
    <PanelPropertyRow
      label="Responses"
      value={context.usage.responseCount.toLocaleString()}
    />
    <PanelPropertyRow
      label="Input tokens"
      value={context.usage.input.toLocaleString()}
    />
    <PanelPropertyRow
      label="Output tokens"
      value={context.usage.output.toLocaleString()}
    />
    <PanelPropertyRow
      label="Cache read"
      value={context.usage.cacheRead.toLocaleString()}
    />
    <PanelPropertyRow
      label="Cache write"
      value={context.usage.cacheWrite.toLocaleString()}
    />
    <PanelPropertyRow
      label="Total tokens"
      value={context.usage.totalTokens.toLocaleString()}
    />
    <PanelPropertyRow
      label="Cost"
      value={`$${context.usage.cost.toFixed(4)}`}
    />
  {:else}<PanelEmpty
      title={store?.loading
        ? "Loading conversation…"
        : "No conversation selected"}
    />{/if}
</PanelView>

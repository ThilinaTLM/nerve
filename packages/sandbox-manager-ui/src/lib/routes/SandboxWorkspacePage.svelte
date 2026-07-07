<script lang="ts">
  import { Activity, ArrowLeft, MessageSquareOff } from "@lucide/svelte";
  import { TranscriptList } from "@nervekit/conversation-ui";
  import { setConversationUiCapabilities } from "@nervekit/conversation-ui/context";
  import type { ThinkingLevel } from "@nervekit/shared";
  import { Button } from "@nervekit/ui/components/ui/button";
  import SelectField from "@nervekit/ui/components/ui/select-field";
  import type { SelectItem } from "@nervekit/ui/components/ui/select-field";
  import SandboxPromptComposer from "../components/composer/SandboxPromptComposer.svelte";
  import SandboxActionMenu from "../components/SandboxActionMenu.svelte";
  import SandboxBootProgress from "../components/SandboxBootProgress.svelte";
  import SandboxDiagnosticsSheet from "../components/SandboxDiagnosticsSheet.svelte";
  import SandboxStatusBadge from "../components/SandboxStatusBadge.svelte";
  import AppShell from "../components/layout/AppShell.svelte";
  import { buildSandboxChatRender } from "../state/sandbox-chat-render";
  import {
    sandboxMessageMenu,
    sandboxToolMenu,
  } from "../state/sandbox-conversation-menus";
  import {
    pendingApprovalRecords,
    pendingUserQuestionRecord,
  } from "../state/sandbox-review-records";
  import { resolveToolCallDetails } from "../state/sandbox-tool-call-details";
  import { modelKey } from "../utils/model-display";
  import {
    computeSandboxBootProgress,
    isSandboxConnected,
    isSandboxTerminal,
  } from "../state/sandbox-boot-progress";
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
  const connected = $derived(isSandboxConnected(detail));
  const render = $derived(buildSandboxChatRender(richState));
  const progress = $derived(computeSandboxBootProgress(record, detail));
  const booting = $derived(!connected && !isSandboxTerminal(record));
  const hasContent = $derived(
    render.timeline.length > 0 || Boolean(render.streamingText),
  );

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
  // An empty conversation snapshot defaults `readOnly` to true; only treat it as
  // blocking when there is actual transcript content (a genuine read-only
  // session), otherwise the first prompt could never be sent.
  const readOnly = $derived(Boolean(richState?.readOnly) && hasContent);

  // The sandbox ConversationSnapshot does not carry approval/question records,
  // so reconstruct them from the live wait reducer state (see the helpers).
  const approvals = $derived(pendingApprovalRecords(detail, richState));
  const pendingUserQuestion = $derived(pendingUserQuestionRecord(detail));
  const blockedForReview = $derived(
    approvals.length > 0 || Boolean(pendingUserQuestion),
  );

  const composerDisabled = $derived(
    isSandboxTerminal(record) ||
      (detail?.sending ?? false) ||
      readOnly ||
      blockedForReview,
  );

  // Agent controls surfaced by the composer toolbar.
  const controls = $derived(detail?.agentControls);
  const selectedModelKey = $derived(
    controls
      ? modelKey({ provider: controls.provider, modelId: controls.model })
      : "",
  );
  const selectedModel = $derived(
    store.models.find((model) => modelKey(model) === selectedModelKey),
  );
  const composerHint = $derived(
    detail?.queuedPrompt
      ? "Message queued — sends when the sandbox is ready."
      : booting
        ? "Sandbox is booting — your message will send when ready."
        : undefined,
  );

  function handleModelChange(key: string): void {
    if (!detail || !controls) return;
    const model = store.models.find((item) => modelKey(item) === key);
    if (!model) return;
    controls.provider = model.provider;
    controls.model = model.modelId;
    const supported = model.supportedThinkingLevels?.length
      ? model.supportedThinkingLevels
      : (["off"] as ThinkingLevel[]);
    if (!supported.includes(controls.thinkingLevel))
      controls.thinkingLevel = supported[0];
    void store.configureAgent(sandboxId, {
      model: {
        provider: controls.provider,
        model: controls.model,
        thinkingLevel: controls.thinkingLevel,
      },
    });
  }

  function handleThinkingLevelChange(level: ThinkingLevel): void {
    if (!detail || !controls) return;
    controls.thinkingLevel = level;
    void store.configureAgent(sandboxId, {
      model: {
        provider: controls.provider,
        model: controls.model,
        thinkingLevel: level,
      },
    });
  }

  function handleModeChange(mode: "normal" | "planning"): void {
    if (!controls) return;
    controls.mode = mode;
    void store.configureAgent(sandboxId, { mode });
  }

  function handlePermissionChange(
    level: "read_only" | "supervised" | "autonomous",
  ): void {
    if (!controls) return;
    controls.permissionLevel = level;
    void store.configureAgent(sandboxId, { permissionLevel: level });
  }

  function handleApprovalPolicyChange(policy: {
    autoApproveReadOnly: boolean;
  }): void {
    if (!controls) return;
    controls.approvalPolicy = policy;
    void store.configureAgent(sandboxId, { approvalPolicy: policy });
  }

  // Tool-call details dialog resolves the full sandbox record when connected.
  setConversationUiCapabilities({
    fetchToolCall: (toolCallId) =>
      resolveToolCallDetails(richState, sandboxId, toolCallId, { connected }),
  });

  let diagnosticsOpen = $state(false);
  let railExpanded = $state(true);
  let hasAutoCollapsed = false;

  // Collapse the boot rail once the sandbox is ready for chat.
  $effect(() => {
    if (connected && !hasAutoCollapsed) {
      railExpanded = false;
      hasAutoCollapsed = true;
    }
  });

  // Auto-dispatch a queued first prompt once the controller connects.
  $effect(() => {
    if (connected && detail?.queuedPrompt) void store.flushQueuedPrompt(sandboxId);
  });
</script>

<AppShell {route} contentVariant="full">
  <div class="flex flex-none flex-wrap items-center gap-3 border-b px-4 py-2.5">
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Back to fleet"
      onclick={() => route.fleet()}
    >
      <ArrowLeft class="size-4" />
    </Button>
    <div class="flex min-w-0 flex-col">
      <span class="truncate text-sm font-semibold">{record?.name ?? sandboxId}</span>
      <span class="truncate font-mono text-xs text-muted-foreground">{sandboxId}</span>
    </div>
    {#if record}<SandboxStatusBadge {record} />{/if}

    <div class="ml-auto flex items-center gap-2">
      {#if conversationItems.length > 1 && detail}
        <SelectField
          items={conversationItems}
          value={detail.selectedConversationId ?? ""}
          ariaLabel="Select conversation"
          class="max-w-xs"
          onValueChange={(value) => {
            if (detail) detail.selectedConversationId = value;
          }}
        />
      {/if}
      {#if record}
        <Button variant="outline" size="sm" onclick={() => (diagnosticsOpen = true)}>
          <Activity class="size-4" /> Diagnostics
        </Button>
        <SandboxActionMenu {record} compact />
      {/if}
    </div>
  </div>

  {#if !record}
    <div class="flex flex-1 items-center justify-center p-6">
      <div class="rounded-md border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        {detail?.loading ? "Loading sandbox…" : "Sandbox not found."}
      </div>
    </div>
  {:else}
    <div class="flex min-h-0 flex-1">
      <!-- Chat column -->
      <div class="flex min-w-0 flex-1 flex-col">
        {#if record.lastError}
          <p class="flex-none border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
            {record.lastError.code}: {record.lastError.message}
          </p>
        {/if}

        {#if booting}
          <div class="flex-none border-b p-3 lg:hidden">
            <SandboxBootProgress {record} variant="banner" />
          </div>
        {/if}

        <div class="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
          {#if hasContent}
            <div
              class="flex min-h-0 flex-1 flex-col"
              role="log"
              aria-label="Conversation transcript"
              aria-live="polite"
            >
              <TranscriptList
                timeline={render.timeline}
                streamingText={render.streamingText}
                sending={detail?.sending ?? false}
                hasLiveTimelineNodes={render.hasLiveTimelineNodes}
                queuedPrompts={[]}
                paddingEnd={18}
                heightCacheKey={detail?.selectedConversationId}
                {approvals}
                {pendingUserQuestion}
                onGrantApproval={(id) =>
                  void store.resolveApproval(sandboxId, id, "grant")}
                onDenyApproval={(id) =>
                  void store.resolveApproval(sandboxId, id, "deny")}
                onAnswerUserQuestion={(questionId, answer) =>
                  void store.submitInput(sandboxId, questionId, answer)}
                messageMenu={sandboxMessageMenu}
                toolMenu={sandboxToolMenu}
              />
            </div>
          {:else if booting}
            <div class="flex flex-1 flex-col items-center justify-center gap-4 p-6">
              <div class="w-full max-w-md">
                <SandboxBootProgress {record} variant="banner" />
              </div>
              <p class="max-w-md text-center text-sm text-muted-foreground">
                You can type your first message now — it'll send automatically
                when the sandbox is ready.
              </p>
            </div>
          {:else}
            <div class="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
              <MessageSquareOff class="size-8 text-muted-foreground" />
              <p class="text-sm text-muted-foreground">
                {connected
                  ? "No conversation yet. Send a prompt to start a run."
                  : "No controller session connected. Chat is read-only until the sandbox reconnects."}
              </p>
            </div>
          {/if}

          {#if detail && controls}
            <SandboxPromptComposer
              text={detail.composerText}
              disabled={composerDisabled}
              sending={canCancel}
              models={store.models}
              {selectedModelKey}
              thinkingLevel={controls.thinkingLevel}
              mode={controls.mode}
              permissionLevel={controls.permissionLevel}
              approvalPolicy={controls.approvalPolicy}
              contextUsage={richState?.contextUsage}
              contextWindow={selectedModel?.contextWindow ?? 0}
              hint={composerHint}
              onChange={(text) => {
                if (detail) detail.composerText = text;
              }}
              onSubmit={() =>
                void store.submitPrompt(sandboxId, detail.composerText)}
              onAbort={canCancel
                ? () => void store.cancelRun(sandboxId)
                : undefined}
              onModelChange={handleModelChange}
              onThinkingLevelChange={handleThinkingLevelChange}
              onModeChange={handleModeChange}
              onPermissionChange={handlePermissionChange}
              onApprovalPolicyChange={handleApprovalPolicyChange}
            />
          {/if}
        </div>
      </div>

      <!-- Boot rail -->
      <aside class="hidden w-80 shrink-0 flex-col border-l lg:flex">
        <SandboxBootProgress
          {record}
          variant="rail"
          expanded={railExpanded}
          onToggle={() => (railExpanded = !railExpanded)}
        />
      </aside>
    </div>

    <SandboxDiagnosticsSheet bind:open={diagnosticsOpen} {record} />
  {/if}
</AppShell>

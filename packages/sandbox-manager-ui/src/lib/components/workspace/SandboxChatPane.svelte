<script lang="ts">
  import MessageSquareOff from "@lucide/svelte/icons/message-square-off";
  import {
    buildConversationRenderProjection,
    ConversationPaneLayout,
    createConversationScrollController,
    TranscriptList,
  } from "@nervekit/conversation-ui";
  import { setConversationUiCapabilities } from "@nervekit/conversation-ui/context";
  import type { ThinkingLevel } from "@nervekit/shared";
  import SandboxPromptComposer from "../composer/SandboxPromptComposer.svelte";
  import SandboxBootProgress from "../SandboxBootProgress.svelte";
  import {
    computeSandboxBootProgress,
    isSandboxConnected,
    isSandboxTerminal,
  } from "../../state/sandbox-boot-progress";
  import {
    sandboxMessageMenu,
    sandboxToolMenu,
  } from "../../state/sandbox-conversation-menus";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import {
    pendingApprovalRecords,
    pendingUserQuestionRecord,
  } from "../../state/sandbox-review-records";
  import { resolveToolCallDetails } from "../../state/sandbox-tool-call-details";
  import { modelKey } from "../../utils/model-display";

  let { sandboxId }: { sandboxId: string } = $props();

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
  const render = $derived(buildConversationRenderProjection(richState));
  const progress = $derived(computeSandboxBootProgress(record, detail));
  const booting = $derived(
    !connected && !isSandboxTerminal(record) && progress.state !== "failed",
  );
  const hasContent = $derived(
    render.timeline.length > 0 || Boolean(render.streamingText),
  );
  const lastTimelineKey = $derived(render.timeline.at(-1)?.key);
  const transcriptHeightCacheKey = $derived(
    `${sandboxId}:${detail?.selectedConversationId ?? "default"}`,
  );
  const scrollConversationId = $derived(
    detail?.selectedConversationId ?? richState?.conversationId ?? "default",
  );
  const scroll = createConversationScrollController({
    conversationOpen: () => hasContent,
    conversationId: () => scrollConversationId,
    contentReady: () => render.timeline.length > 0,
  });

  const activeRun = $derived(
    richState?.activeRun ??
      (detail?.selectedRunId ? detail.liveRuns[detail.selectedRunId] : undefined),
  );
  const canCancel = $derived(
    activeRun?.status === "running" ||
      activeRun?.status === "queued" ||
      activeRun?.status === "streaming",
  );
  const readOnly = $derived(Boolean(richState?.readOnly) && hasContent);
  const approvals = $derived(pendingApprovalRecords(detail, richState));
  const pendingUserQuestion = $derived(pendingUserQuestionRecord(detail, richState));
  const blockedForReview = $derived(
    approvals.length > 0 || Boolean(pendingUserQuestion),
  );
  const composerDisabled = $derived(
    isSandboxTerminal(record) ||
      progress.state === "failed" ||
      (detail?.sending ?? false) ||
      readOnly ||
      blockedForReview,
  );
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
      : progress.state === "failed"
        ? "Sandbox startup failed — fix the sandbox and restart it before chatting."
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
    if (!supported.includes(controls.thinkingLevel)) controls.thinkingLevel = supported[0];
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
      model: { provider: controls.provider, model: controls.model, thinkingLevel: level },
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

  function handleApprovalPolicyChange(policy: { autoApproveReadOnly: boolean }): void {
    if (!controls) return;
    controls.approvalPolicy = policy;
    void store.configureAgent(sandboxId, { approvalPolicy: policy });
  }

  setConversationUiCapabilities({
    fetchToolCall: (toolCallId) =>
      resolveToolCallDetails(richState, sandboxId, toolCallId, { connected }),
  });

  $effect(() => {
    if (connected && detail?.queuedPrompt) void store.flushQueuedPrompt(sandboxId);
  });
</script>

<ConversationPaneLayout
  open={true}
  showScrollButton={hasContent && !scroll.atEnd}
  composerHeight={scroll.composerHeight}
  onJumpToBottom={() => scroll.jumpToBottom()}
  bind:composerWrapRef={scroll.composerWrapEl}
>
  {#snippet transcript()}
    {#if hasContent}
      <TranscriptList
        bind:controller={scroll.controller}
        bind:atEnd={scroll.atEnd}
        timeline={render.timeline}
        streamingText={render.streamingText}
        sending={richState?.sending ?? detail?.sending ?? false}
        hasLiveTimelineNodes={render.hasLiveTimelineNodes}
        queuedPrompts={render.queuedPrompts}
        contentVisibility={true}
        followBottom={scroll.followBottom}
        paddingEnd={18}
        heightCacheKey={transcriptHeightCacheKey}
        {approvals}
        {pendingUserQuestion}
        {lastTimelineKey}
        onGrantApproval={(id) => void store.resolveApproval(sandboxId, id, "grant")}
        onDenyApproval={(id) => void store.resolveApproval(sandboxId, id, "deny")}
        onAnswerUserQuestion={(questionId, answer) => void store.submitInput(sandboxId, questionId, answer)}
        onOpenFile={(path, line) => void store.openWorkspaceFile(sandboxId, path, line)}
        messageMenu={sandboxMessageMenu}
        toolMenu={sandboxToolMenu}
      />
    {:else if booting && record}
      <div class="flex min-h-0 flex-col items-center justify-center gap-4 p-6">
        <div class="w-full max-w-md"><SandboxBootProgress {record} variant="banner" /></div>
        <p class="max-w-md text-center text-sm text-muted-foreground">You can type your first message now — it'll send automatically when the sandbox is ready.</p>
      </div>
    {:else}
      <div class="flex min-h-0 flex-col items-center justify-center gap-2 p-4 text-center">
        <MessageSquareOff class="size-8 text-muted-foreground" />
        <p class="text-sm text-muted-foreground">
          {connected
            ? "No conversation yet. Send a prompt to start a run."
            : progress.state === "failed"
              ? "Sandbox startup failed. Review the boot details and restart after fixing the config."
              : "No controller session connected. Chat is read-only until the sandbox reconnects."}
        </p>
      </div>
    {/if}
  {/snippet}

  {#snippet composer()}
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
        onChange={(text) => { if (detail) detail.composerText = text; }}
        onSubmit={() => void store.submitPrompt(sandboxId, detail.composerText)}
        onAbort={canCancel ? () => void store.cancelRun(sandboxId) : undefined}
        onModelChange={handleModelChange}
        onThinkingLevelChange={handleThinkingLevelChange}
        onModeChange={handleModeChange}
        onPermissionChange={handlePermissionChange}
        onApprovalPolicyChange={handleApprovalPolicyChange}
      />
    {/if}
  {/snippet}

  {#snippet empty()}
    <div></div>
  {/snippet}
</ConversationPaneLayout>

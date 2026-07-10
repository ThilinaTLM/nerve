<script lang="ts">
  import {
    AgentConversationPane,
    buildConversationRenderProjection,
  } from "@nervekit/workbench-ui";
  import { setConversationUiCapabilities } from "@nervekit/workbench-ui/context";
  import type { ThinkingLevel } from "@nervekit/contracts";
  import { computeSandboxBootProgress } from "../../state/sandbox-boot-progress";
  import {
    sandboxCanForwardCommand,
    sandboxCanQueuePrompt,
    sandboxIsConnected,
    sandboxIsReadOnly,
    sandboxLifecycleMessage,
  } from "../../state/sandbox-lifecycle";
  import {
    activeComposerText,
    activeQueuedPrompt,
  } from "../../state/sandbox-conversation-state";
  import { sandboxAvailableModels } from "../../state/sandbox-manager-selectors.svelte";
  import {
    sandboxMessageMenu,
    sandboxToolMenu,
  } from "../../state/sandbox-conversation-menus";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import {
    pendingApprovalRecords,
    pendingPlanReviewRecord,
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
      : undefined,
  );
  const connected = $derived(sandboxIsConnected(detail));
  const render = $derived(buildConversationRenderProjection(richState));
  const progress = $derived(computeSandboxBootProgress(record, detail));
  const booting = $derived(
    !connected && sandboxCanQueuePrompt(record, detail) && progress.state !== "failed",
  );
  const hasContent = $derived(
    render.timeline.length > 0 || Boolean(render.streamingText),
  );
  const transcriptHeightCacheKey = $derived(
    `${sandboxId}:${detail?.selectedPendingConversationId ?? detail?.selectedConversationId ?? "default"}`,
  );
  const scrollConversationId = $derived(
    detail?.selectedPendingConversationId ??
      detail?.selectedConversationId ??
      richState?.conversationId ??
      "default",
  );

  const activeRun = $derived(
    richState?.activeRun ??
      (detail?.selectedRunId ? detail.liveRuns[detail.selectedRunId] : undefined),
  );
  const canForward = $derived(sandboxCanForwardCommand(record, detail));
  const canCancel = $derived(
    canForward &&
      (activeRun?.status === "running" ||
        activeRun?.status === "queued" ||
        activeRun?.status === "streaming"),
  );
  const readOnly = $derived(sandboxIsReadOnly(record, detail));
  const snapshotReadOnly = $derived(Boolean(richState?.readOnly) && hasContent);
  const lifecycleMessage = $derived(sandboxLifecycleMessage(record, detail));
  const snapshotMessage = $derived(
    richState?.fallbackReason ??
      detail?.lastRichSnapshot?.reason ??
      "Transcript reconstructed from durable manager events.",
  );
  const approvals = $derived(pendingApprovalRecords(detail, richState));
  const pendingUserQuestion = $derived(pendingUserQuestionRecord(detail, richState));
  const pendingPlanReview = $derived(pendingPlanReviewRecord(detail, richState));
  const blockedForReview = $derived(
    approvals.length > 0 ||
      Boolean(pendingUserQuestion) ||
      Boolean(pendingPlanReview),
  );
  const composerDisabled = $derived(
    !sandboxCanQueuePrompt(record, detail) ||
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
  const composerModels = $derived(sandboxAvailableModels(store.models, detail));
  const selectedModel = $derived(
    composerModels.find((model) => modelKey(model) === selectedModelKey),
  );
  const composerText = $derived(activeComposerText(detail));
  const queuedPrompt = $derived(activeQueuedPrompt(detail));
  const composerHint = $derived(
    queuedPrompt
      ? "Message queued — sends when the sandbox is ready."
      : readOnly || !sandboxCanQueuePrompt(record, detail)
        ? lifecycleMessage
        : booting
          ? "Sandbox is booting — your message will send when ready."
          : undefined,
  );

  function handleModelChange(key: string): void {
    if (!detail || !controls) return;
    const model = composerModels.find((item) => modelKey(item) === key);
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

  function handleModeChange(mode: "coding" | "planning"): void {
    if (!controls) return;
    const sandboxMode = mode === "coding" ? "normal" : "planning";
    controls.mode = sandboxMode;
    void store.configureAgent(sandboxId, { mode: sandboxMode });
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
    if (connected && queuedPrompt) void store.flushQueuedPrompt(sandboxId);
  });
</script>

<AgentConversationPane
  model={{
    conversationId: scrollConversationId,
    open: true,
    hasContent,
    active: true,
    timeline: render.timeline,
    streamingText: render.streamingText,
    sending: richState?.sending ?? detail?.sending ?? false,
    hasLiveTimelineNodes: render.hasLiveTimelineNodes,
    queuedPrompts: render.queuedPrompts,
    approvals,
    pendingUserQuestion,
    pendingPlanReview,
    planReviewModels: composerModels,
    planReviewModelKey: selectedModelKey,
    planReviewThinkingLevel: controls?.thinkingLevel ?? "off",
    banner:
      readOnly || snapshotReadOnly
        ? {
            tone: "warning",
            title: "Read-only snapshot.",
            message: readOnly ? lifecycleMessage : snapshotMessage,
          }
        : undefined,
    emptyTitle: booting
      ? "No conversation yet. Boot details are available in the Summary tab."
      : connected
        ? "No conversation yet. Send a prompt to start a run."
        : progress.state === "failed" || readOnly
          ? lifecycleMessage
          : "No controller session connected. Chat is read-only until the sandbox reconnects.",
    emptyMessage: booting
      ? "You can type your first message now — it'll send automatically when the sandbox is ready."
      : undefined,
    transcriptHeightCacheKey,
    composer: {
      text: composerText,
      disabled: composerDisabled,
      sending: canCancel,
      models: composerModels,
      selectedModelKey,
      thinkingLevel: controls?.thinkingLevel ?? "off",
      mode: controls?.mode === "planning" ? "planning" : "coding",
      permissionLevel: controls?.permissionLevel ?? "autonomous",
      approvalPolicy: controls?.approvalPolicy ?? { autoApproveReadOnly: true },
      contextUsage: richState?.contextUsage,
      contextWindow: selectedModel?.contextWindow ?? 0,
      hint: composerHint,
      capabilities: { queueing: true },
    },
  }}
  actions={{
    onComposerChange: (text) => {
      if (detail) store.setComposerText(sandboxId, text);
    },
    onSubmit: () => void store.submitPrompt(sandboxId, composerText),
    onAbort: canCancel ? () => void store.cancelRun(sandboxId) : undefined,
    onModelChange: handleModelChange,
    onThinkingLevelChange: handleThinkingLevelChange,
    onModeChange: handleModeChange,
    onPermissionChange: handlePermissionChange,
    onApprovalPolicyChange: handleApprovalPolicyChange,
    onGrantApproval: canForward
      ? (id) => void store.resolveApproval(sandboxId, id, "grant")
      : undefined,
    onDenyApproval: canForward
      ? (id) => void store.resolveApproval(sandboxId, id, "deny")
      : undefined,
    onAnswerUserQuestion: canForward
      ? (questionId, answer) =>
          void store.submitInput(sandboxId, questionId, answer)
      : undefined,
    onAcceptPlanReview: canForward
      ? (reviewId, options) =>
          store.resolvePlanReview(sandboxId, reviewId, "accept", options)
      : undefined,
    onRejectPlanReview: canForward
      ? (reviewId) =>
          void store.resolvePlanReview(sandboxId, reviewId, "request_changes", {
            feedback: "Rejected from sandbox UI.",
          })
      : undefined,
    onOpenFile: (path, line) =>
      void store.openWorkspaceFile(sandboxId, path, line),
  }}
  menus={{
    messageMenu: sandboxMessageMenu,
    toolMenu: sandboxToolMenu,
  }}
/>

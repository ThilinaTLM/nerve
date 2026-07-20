<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import { buildConversationRenderProjection } from "@nervekit/workbench-ui";
import {
  ConversationEmptyState,
  ConversationPane,
  ConversationSignal,
} from "@nervekit/workbench-ui/components/conversation";
import { setConversationUiCapabilities } from "@nervekit/workbench-ui/context";
import { currentTodosForAgent } from "@nervekit/workbench-ui/state";
import { isInlineCommandPrompt } from "@nervekit/contracts";
import type { QueuedPromptRecord, ThinkingLevel } from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
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
import { isSandboxRunActive } from "../../state/sandbox-prompt-routing";
import {
  sandboxMessageMenu,
  sandboxToolMenu,
} from "../../state/sandbox-conversation-menus";
import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
import {
  pendingApprovalRecords,
  pendingPlanReviewRecords,
  pendingUserQuestionRecords,
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
  !connected &&
    sandboxCanQueuePrompt(record, detail) &&
    progress.state !== "failed",
);
const hasSnapshotContent = $derived(
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
const runActive = $derived(isSandboxRunActive(activeRun?.status));
const canCancel = $derived(
  canForward &&
    runActive &&
    activeRun?.status !== "interrupted" &&
    activeRun?.status !== "recoverable_failed",
);
const readOnly = $derived(sandboxIsReadOnly(record, detail));
const snapshotReadOnly = $derived(
  Boolean(richState?.readOnly) && hasSnapshotContent,
);
const lifecycleMessage = $derived(sandboxLifecycleMessage(record, detail));
const snapshotMessage = $derived(
  richState?.fallbackReason ??
    detail?.lastRichSnapshot?.reason ??
    "Transcript reconstructed from durable manager events.",
);
const approvals = $derived(pendingApprovalRecords(detail, richState));
const pendingUserQuestions = $derived(
  pendingUserQuestionRecords(detail, richState),
);
const pendingPlanReviews = $derived(
  pendingPlanReviewRecords(detail, richState),
);
const blockedForReview = $derived(
  approvals.length > 0 ||
    pendingUserQuestions.length > 0 ||
    pendingPlanReviews.length > 0,
);
const composerText = $derived(activeComposerText(detail));
const queuedPrompt = $derived(activeQueuedPrompt(detail));
const composerBlocked = $derived(
  !sandboxCanQueuePrompt(record, detail) || readOnly || blockedForReview,
);
const conversationSending = $derived(
  Boolean(detail?.sending || richState?.sending || runActive),
);
const composerSubmitDisabled = $derived(
  composerBlocked ||
    (detail?.sending ?? false) ||
    (conversationSending && isInlineCommandPrompt(composerText)),
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
let composerFocusToken = $state(0);
const activeAgentId = $derived(
  richState?.activeRun?.agentId ?? detail?.selectedAgentId,
);
const composerTodos = $derived(
  currentTodosForAgent(richState?.toolCalls ?? [], activeAgentId),
);
const activeRunId = $derived(
  richState?.activeRun?.runId ?? detail?.selectedRunId,
);
const stopping = $derived(
  canCancel &&
    detail?.stoppingRunId !== undefined &&
    detail.stoppingRunId === activeRunId,
);
/** Client-side queued prompt (held until the sandbox is ready) as a row. */
const LOCAL_QUEUED_PROMPT_ID = "promptq_local";
const localQueuedPrompts = $derived<QueuedPromptRecord[]>(
  queuedPrompt
    ? [
        {
          id: LOCAL_QUEUED_PROMPT_ID,
          agentId: activeAgentId ?? "agent_local",
          conversationId: richState?.conversationId ?? "conv_local",
          projectId: "proj_local",
          behavior: "follow-up",
          text: queuedPrompt,
          status: "queued",
          createdAt: "1970-01-01T00:00:00.000Z",
          updatedAt: "1970-01-01T00:00:00.000Z",
        },
      ]
    : [],
);

function quoteInComposer(text: string): void {
  if (!detail || !text) return;
  const quoted = `${text
    .trimEnd()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}\n\n`;
  const current = activeComposerText(detail);
  store.setComposerText(
    sandboxId,
    current ? `${current.trimEnd()}\n\n${quoted}` : quoted,
  );
  composerFocusToken += 1;
}

async function discardQueuedPrompt(
  prompt: QueuedPromptRecord,
): Promise<boolean> {
  if (prompt.id === LOCAL_QUEUED_PROMPT_ID) {
    store.discardLocalQueuedPrompt(sandboxId);
    return true;
  }
  return store.discardQueuedPrompt(sandboxId, prompt);
}

async function moveQueuedPromptToComposer(
  prompt: QueuedPromptRecord,
): Promise<void> {
  if (!(await discardQueuedPrompt(prompt))) return;
  store.setComposerText(sandboxId, prompt.text);
  composerFocusToken += 1;
}
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

function handleApprovalPolicyChange(policy: {
  autoApproveReadOnly: boolean;
}): void {
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

<ConversationPane
  model={{
    conversationId: scrollConversationId,
    open: true,
    active: true,
    timeline: render.timeline,
    streamingText: render.streamingText,
    sending: richState?.sending ?? detail?.sending ?? false,
    hasActiveTurnOutput: render.hasActiveTurnOutput,
    queuedPrompts: [...localQueuedPrompts, ...render.queuedPrompts],
    approvals,
    pendingUserQuestions,
    pendingPlanReviews,
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
    transcriptHeightCacheKey,
    composer: {
      text: composerText,
      disabled: composerBlocked,
      submitDisabled: composerSubmitDisabled,
      sending: conversationSending,
      showStop: canCancel,
      stopping,
      models: composerModels,
      selectedModelKey,
      thinkingLevel: controls?.thinkingLevel ?? "off",
      mode: controls?.mode === "planning" ? "planning" : "coding",
      permissionLevel: controls?.permissionLevel ?? "autonomous",
      approvalPolicy: controls?.approvalPolicy ?? { autoApproveReadOnly: true },
      contextUsage: richState?.contextUsage,
      contextWindow: selectedModel?.contextWindow ?? 0,
      hint: composerHint,
      focusToken: composerFocusToken,
      todos: composerTodos,
      capabilities: { queueing: true, shortcuts: true, todos: true },
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
    onContinueFromFailure: canForward
      ? (runId) => void store.continueRun(sandboxId, runId)
      : undefined,
    onDiscardQueuedPrompt: (prompt) => void discardQueuedPrompt(prompt),
    onMoveQueuedPromptToComposer: moveQueuedPromptToComposer,
    onOpenFile: (path, line) =>
      void store.openWorkspaceFile(sandboxId, path, line),
  }}
  menus={{
    messageMenu: (item) => sandboxMessageMenu(item, { quoteInComposer }),
    toolMenu: sandboxToolMenu,
  }}
>
  {#snippet emptyExtension()}
    {#if canForward && !readOnly && !booting}
      <ConversationSignal
        label="Sandbox ready"
        title="Where should we start?"
        message="Send a prompt to explore, plan, and build inside this sandbox."
      >
        {#snippet footer()}
          <Button onclick={() => store.startNewConversation(sandboxId)}>
            <Plus aria-hidden="true" />
            New chat
          </Button>
        {/snippet}
      </ConversationSignal>
    {:else}
      <ConversationEmptyState
        title={booting
          ? "No conversation yet. Boot details are available in the Summary tab."
          : connected
            ? "No conversation yet. Send a prompt to start a run."
            : progress.state === "failed" || readOnly
              ? lifecycleMessage
              : "No controller session connected. Chat is read-only until the sandbox reconnects."}
        message={booting
          ? "You can type your first message now — it'll send automatically when the sandbox is ready."
          : undefined}
      />
    {/if}
  {/snippet}
</ConversationPane>

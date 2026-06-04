<script lang="ts">
  import Send from "@lucide/svelte/icons/send";
  import Square from "@lucide/svelte/icons/square";
  import {
    uploadClipboardImage,
    type AgentRecord,
    type ApprovalWithToolCall,
    type CompletionItem,
    type ModelInfo,
    type PlanReviewRecord,
    type ProjectRecord,
    type SessionRecord,
    type UserQuestionRecord,
  } from "../../api";
  import CodeMirrorComposer from "../../CodeMirrorComposer.svelte";
  import { modelKey } from "../../utils/model";
  import { Button } from "$lib/components/ui/button";
  import Select, { type SelectItem } from "$lib/components/ui/select-field";
  import ApprovalStrip from "./ApprovalStrip.svelte";
  import PlanReviewStrip from "./PlanReviewStrip.svelte";
  import UserQuestionStrip from "./UserQuestionStrip.svelte";

  type Mode = AgentRecord["mode"];
  type PermissionLevel = AgentRecord["permissionLevel"];
  type ThinkingLevel = AgentRecord["thinkingLevel"];

  type Props = {
    text?: string;
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
    approvals?: ApprovalWithToolCall[];
    pendingUserQuestion?: UserQuestionRecord;
    pendingPlanReview?: PlanReviewRecord;
    live?: boolean;
    sending?: boolean;
    error?: string;
    models?: ModelInfo[];
    selectedModelKey?: string;
    thinkingLevel?: ThinkingLevel;
    mode?: Mode;
    permissionLevel?: PermissionLevel;
    slashCompletions?: CompletionItem[];
    fileCompletions?: (query: string) => Promise<CompletionItem[]>;
    onChange?: (value: string) => void;
    onSubmit?: () => void;
    onAnswerUserQuestion?: () => void;
    onDismissUserQuestion?: () => void;
    onAbort?: () => void;
    onModelChange?: (value: string) => void;
    onThinkingLevelChange?: (value: ThinkingLevel) => void;
    onModeChange?: (value: Mode) => void;
    onPermissionChange?: (value: PermissionLevel) => void;
    onGrantApproval?: (id: string) => void;
    onDenyApproval?: (id: string) => void;
    onAcceptPlanReview?: (id: string) => void;
    onRequestPlanChanges?: (id: string, feedback: string) => void;
    onDiscardPlanReview?: (id: string) => void;
  };

  let {
    text = "",
    activeProject,
    activeSession,
    approvals = [],
    pendingUserQuestion,
    pendingPlanReview,
    live = false,
    sending = false,
    error,
    models = [],
    selectedModelKey = "",
    thinkingLevel = "off",
    mode = "coding",
    permissionLevel = "autonomous",
    slashCompletions = [],
    fileCompletions,
    onChange,
    onSubmit,
    onAnswerUserQuestion,
    onDismissUserQuestion,
    onAbort,
    onModelChange,
    onThinkingLevelChange,
    onModeChange,
    onPermissionChange,
    onGrantApproval,
    onDenyApproval,
    onAcceptPlanReview,
    onRequestPlanChanges,
    onDiscardPlanReview,
  }: Props = $props();

  const pendingApproval = $derived(approvals.length > 0);
  const pendingQuestion = $derived(Boolean(pendingUserQuestion));
  const pendingPlan = $derived(Boolean(pendingPlanReview));
  const blockedForReview = $derived(pendingApproval || pendingPlan);
  const canPrompt = $derived(Boolean(activeProject && activeSession && live && models.length > 0 && !blockedForReview && !pendingQuestion));
  const canAnswerQuestion = $derived(Boolean(activeSession && live && pendingQuestion && !blockedForReview));
  const editorDisabled = $derived(blockedForReview || (!pendingQuestion && (sending || !canPrompt)) || (pendingQuestion && !canAnswerQuestion));
  const submitDisabled = $derived(pendingQuestion ? !canAnswerQuestion : !canPrompt);

  function submitComposer() {
    if (pendingQuestion && !blockedForReview) onAnswerUserQuestion?.();
    else if (!blockedForReview) onSubmit?.();
  }

  async function pasteImage(file: File): Promise<string> {
    return uploadClipboardImage(file);
  }
  const modelItems = $derived<SelectItem[]>(models.length
    ? models.map((model) => ({
      value: modelKey(model),
      label: model.label,
      detail: model.provider,
    }))
    : [{ value: "", label: "No configured models", detail: "Run nerve auth list", disabled: true }]);

  const selectedModel = $derived(models.find((model) => modelKey(model) === selectedModelKey));

  const thinkingLevelDetails: Record<ThinkingLevel, string> = {
    off: "No reasoning",
    minimal: "Very brief reasoning",
    low: "Light reasoning",
    medium: "Moderate reasoning",
    high: "Deep reasoning",
    xhigh: "Maximum reasoning",
  };

  function thinkingLevelLabel(level: ThinkingLevel): string {
    return level === "off" ? "Off" : level[0].toUpperCase() + level.slice(1);
  }

  const thinkingLevels = $derived<ThinkingLevel[]>(
    selectedModel?.supportedThinkingLevels?.length
      ? selectedModel.supportedThinkingLevels
      : ["off"],
  );

  const thinkingItems = $derived<SelectItem[]>(
    thinkingLevels.map((level) => ({
      value: level,
      label: thinkingLevelLabel(level),
      detail: thinkingLevelDetails[level],
    })),
  );

  const modeItems: SelectItem[] = [
    { value: "coding", label: "Coding", detail: "Implement and modify files" },
    { value: "planning", label: "Planning", detail: "Read and prepare before edits" },
  ];

  const permissionItems: SelectItem[] = [
    { value: "read_only", label: "Read only", detail: "No writes or mutating commands" },
    { value: "supervised", label: "Supervised", detail: "Ask before non-read tool calls" },
    { value: "autonomous", label: "Autonomous", detail: "Allow tool calls without approval" },
  ];
</script>

<form class="composer" data-pending-approval={pendingApproval ? "true" : undefined} data-pending-question={pendingQuestion ? "true" : undefined} data-pending-plan={pendingPlan ? "true" : undefined} onsubmit={(event) => { event.preventDefault(); submitComposer(); }}>
  <ApprovalStrip {approvals} {onGrantApproval} {onDenyApproval} />
  <PlanReviewStrip planReview={pendingPlanReview} onAccept={onAcceptPlanReview} onRequestChanges={onRequestPlanChanges} onDiscard={onDiscardPlanReview} />
  <UserQuestionStrip question={pendingUserQuestion} onDismiss={onDismissUserQuestion} />

  <div class="composer-surface">
    <div class="editor-shell">
      {#if pendingApproval}
        <div class="approval-waiting" aria-live="polite">Waiting for approval to proceed…</div>
      {:else if pendingPlan}
        <div class="approval-waiting" aria-live="polite">Waiting for your plan review…</div>
      {:else if pendingQuestion}
        <div class="approval-waiting" aria-live="polite">Waiting for your reply…</div>
      {/if}
      <CodeMirrorComposer
        value={text}
        disabled={editorDisabled}
        placeholder={pendingApproval ? "Approval required before the agent can continue…" : pendingPlan ? "Review the plan above before the agent can continue…" : pendingUserQuestion?.placeholder ?? (pendingQuestion ? "Reply to the agent's question…" : "Ask the local Nerve agent…")}
        {slashCompletions}
        {fileCompletions}
        onChange={onChange}
        onSubmit={submitComposer}
        onPasteImage={pasteImage}
      />
    </div>

    <div class="composer-control-row">
      <div class="composer-inputs" aria-label="Prompt settings">
        <Select
          class="composer-field model-field"
          triggerClass="composer-select-trigger model-select-trigger"
          contentClass="composer-select-content"
          items={modelItems}
          bind:value={selectedModelKey}
          ariaLabel="Model"
          disabled={!activeSession || sending || models.length === 0 || blockedForReview || pendingQuestion}
          onValueChange={(value) => onModelChange?.(value)}
        />
        <Select
          class="composer-field thinking-field"
          triggerClass="composer-select-trigger thinking-select-trigger"
          contentClass="composer-select-content"
          items={thinkingItems}
          value={thinkingLevel}
          ariaLabel="Thinking level"
          disabled={!activeSession || sending || blockedForReview || pendingQuestion || thinkingItems.length <= 1}
          onValueChange={(value) => onThinkingLevelChange?.(value as ThinkingLevel)}
        />
        <Select
          class="composer-field mode-field"
          triggerClass="composer-select-trigger mode-select-trigger"
          contentClass="composer-select-content"
          items={modeItems}
          value={mode}
          ariaLabel="Mode"
          disabled={!activeSession || sending || blockedForReview || pendingQuestion}
          onValueChange={(value) => onModeChange?.(value as Mode)}
        />
        <Select
          class="composer-field access-field"
          triggerClass="composer-select-trigger access-select-trigger"
          contentClass="composer-select-content"
          items={permissionItems}
          value={permissionLevel}
          ariaLabel="Access"
          disabled={!activeSession || sending || blockedForReview || pendingQuestion}
          onValueChange={(value) => onPermissionChange?.(value as PermissionLevel)}
        />
      </div>

      <div class="actions">
        {#if sending && !pendingQuestion}
          <Button variant="secondary" size="icon-sm" class="stop-button" onclick={onAbort} aria-label="Stop generation" title="Stop generation">
            <Square size={13} strokeWidth={2.5} />
          </Button>
        {:else}
          <Button size="icon-sm" class="send-button" type="submit" disabled={submitDisabled} aria-label={pendingQuestion ? "Send reply" : "Send prompt"} title={pendingQuestion ? "Send reply" : "Send prompt"}>
            <Send size={14} strokeWidth={2.4} />
          </Button>
        {/if}
      </div>
    </div>
  </div>

  {#if error}<p class="composer-error">{error}</p>{/if}
</form>

<style>
  .composer {
    display: grid;
    gap: 0.55rem;
    border-top: 1px solid var(--border);
    background: var(--muted);
    padding: 0.65rem;
    box-shadow: var(--shadow-lg);
  }

  .composer-surface {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--input);
    box-shadow: 0 1px 0 color-mix(in oklab, var(--foreground) 4%, transparent) inset;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .composer-surface:focus-within {
    border-color: var(--primary);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--ring) 35%, transparent);
  }

  .editor-shell {
    position: relative;
    min-width: 0;
  }

  .approval-waiting {
    position: absolute;
    z-index: 2;
    top: 0.45rem;
    right: 0.55rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--card);
    color: var(--primary);
    padding: 0.12rem 0.45rem;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
  }

  .editor-shell :global(.composer-editor) {
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .editor-shell :global(.composer-editor:focus-within) {
    box-shadow: none;
  }

  .composer-control-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.55rem;
    padding: 0 0.45rem 0.45rem;
  }

  .composer-inputs {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.35rem;
  }

  :global(.composer-field) {
    width: auto;
    min-width: 0;
  }

  :global(.model-field) {
    width: clamp(9rem, 24vw, 18rem);
  }

  :global(.mode-field) {
    width: 7rem;
  }

  :global(.access-field) {
    width: 8.25rem;
  }

  :global(.composer-select-trigger) {
    min-width: 0;
  }

  :global(.composer-select-content) {
    min-width: max(var(--bits-select-anchor-width, 12rem), 11rem);
  }

  .actions {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: end;
  }

  :global(.send-button),
  :global(.stop-button) {
    border-radius: 999px;
  }

  :global(.send-button) {
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--primary-foreground) 18%, transparent) inset;
  }

  .composer-error {
    margin: 0;
    border: 1px solid color-mix(in oklab, var(--destructive) 16%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--destructive) 16%, transparent);
    color: var(--destructive);
    padding: 0.42rem 0.5rem;
    font-size: 0.75rem;
  }

  @media (max-width: 760px) {
    .composer-control-row {
      align-items: end;
    }

    .composer-inputs {
      flex-wrap: wrap;
    }

    :global(.model-field) {
      width: min(100%, 18rem);
    }
  }
</style>

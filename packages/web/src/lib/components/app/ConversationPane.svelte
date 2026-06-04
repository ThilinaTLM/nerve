<script lang="ts">
  import Clipboard from "@lucide/svelte/icons/clipboard";
  import Copy from "@lucide/svelte/icons/copy";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import TextQuote from "@lucide/svelte/icons/text-quote";
  import { toast } from "svelte-sonner";
  import type { AgentRecord, ApprovalWithToolCall, CompletionItem, ModelInfo, PlanReviewRecord, ProjectRecord, SessionRecord, ToolCallRecord, UserQuestionRecord } from "../../api";
  import Markdown from "../../Markdown.svelte";
  import type { TranscriptItem } from "../../stores/workbench/state.svelte";
  import { buildConversationTimeline } from "../../stores/workbench/timeline";
  import { Button } from "$lib/components/ui/button";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ui/context-menu-list";
  import PromptComposer from "./PromptComposer.svelte";
  import ToolCallCard from "./ToolCallCard.svelte";

  type Props = {
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
    activeAgent?: AgentRecord;
    projects?: ProjectRecord[];
    sessions?: SessionRecord[];
    agents?: AgentRecord[];
    homeDir?: string;
    approvals?: ApprovalWithToolCall[];
    pendingUserQuestion?: UserQuestionRecord;
    pendingPlanReview?: PlanReviewRecord;
    transcript?: TranscriptItem[];
    toolCalls?: ToolCallRecord[];
    streamingText?: string;
    live?: boolean;
    sending?: boolean;
    error?: string;
    composerText?: string;
    models?: ModelInfo[];
    selectedModelKey?: string;
    thinkingLevel?: AgentRecord["thinkingLevel"];
    mode?: AgentRecord["mode"];
    permissionLevel?: AgentRecord["permissionLevel"];
    slashCompletions?: CompletionItem[];
    fileCompletions?: (query: string) => Promise<CompletionItem[]>;
    onComposerChange?: (value: string) => void;
    onSubmit?: () => void;
    onAnswerUserQuestion?: () => void;
    onDismissUserQuestion?: () => void;
    onAbort?: () => void;
    onOpenProject?: () => void;
    onNewConversationInProject?: (projectDir: string) => void;
    onModelChange?: (value: string) => void;
    onThinkingLevelChange?: (value: AgentRecord["thinkingLevel"]) => void;
    onModeChange?: (value: AgentRecord["mode"]) => void;
    onPermissionChange?: (value: AgentRecord["permissionLevel"]) => void;
    onGrantApproval?: (id: string) => void;
    onDenyApproval?: (id: string) => void;
    onAcceptPlanReview?: (id: string) => void;
    onRequestPlanChanges?: (id: string, feedback: string) => void;
    onDiscardPlanReview?: (id: string) => void;
  };

  let {
    activeProject,
    activeSession,
    activeAgent,
    approvals = [],
    pendingUserQuestion,
    pendingPlanReview,
    transcript = [],
    toolCalls = [],
    streamingText = "",
    live = false,
    sending = false,
    error,
    composerText = "",
    models = [],
    selectedModelKey = "",
    thinkingLevel = "off",
    mode = "coding",
    permissionLevel = "autonomous",
    slashCompletions = [],
    fileCompletions,
    onComposerChange,
    onSubmit,
    onAnswerUserQuestion,
    onDismissUserQuestion,
    onAbort,
    onOpenProject,
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

  const timeline = $derived(buildConversationTimeline(transcript, toolCalls));

  async function copyText(text: string, label = "message") {
    try {
      await navigator.clipboard?.writeText(text);
      toast.success(`Copied ${label}`);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  function quoteInComposer(text: string) {
    const quoted = text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const prefix = composerText ? `${composerText}\n\n` : "";
    onComposerChange?.(`${prefix}${quoted}\n\n`);
  }

  function messageMenu(item: TranscriptItem): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { label: "Copy text", icon: Clipboard, onSelect: () => void copyText(item.text) },
      { label: "Quote in composer", icon: TextQuote, onSelect: () => quoteInComposer(item.text) },
    ];
    if (item.id) {
      items.push({ type: "separator" });
      items.push({ label: "Copy message id", icon: Copy, onSelect: () => void copyText(item.id ?? "", "message id") });
    }
    return items;
  }
</script>

<section class="conversation-pane">
  {#if activeSession}
    <div class="transcript" aria-live="polite">
      {#if timeline.length === 0 && !streamingText}
        <div class="empty-run">
          <Sparkles size={28} strokeWidth={1.7} />
          <p>No messages yet.</p>
          <span>Write a prompt below to start this agent conversation.</span>
        </div>
      {/if}

      {#each timeline as node (node.key)}
        {#if node.kind === "tool"}
          <ToolCallCard toolCall={node.toolCall} />
        {:else}
        {@const item = node.item}
        <ContextMenu items={messageMenu(item)} triggerClass="select-text">
          <article class={`transcript-entry ${item.role}`}>
            <div class="message-body">
              <div class="message-content">
                <Markdown text={item.text} />
              </div>
              <Button class="copy-btn" variant="ghost" size="icon-sm" ariaLabel="Copy message" title="Copy message" onclick={() => void copyText(item.text)}>
                <Clipboard size={12} strokeWidth={2.2} />
              </Button>
            </div>
          </article>
        </ContextMenu>
        {/if}
      {/each}

      {#if streamingText}
        <article class="transcript-entry assistant streaming">
          <div class="message-body">
            <div class="message-content streaming-content">
              <Markdown text={streamingText} />
              <span class="stream-caret" aria-hidden="true"></span>
            </div>
          </div>
        </article>
      {/if}
    </div>

    <PromptComposer
      text={composerText}
      {activeProject}
      {activeSession}
      {approvals}
      {pendingUserQuestion}
      {pendingPlanReview}
      {live}
      {sending}
      {error}
      {models}
      {selectedModelKey}
      {thinkingLevel}
      {mode}
      {permissionLevel}
      {slashCompletions}
      {fileCompletions}
      onChange={onComposerChange}
      {onSubmit}
      {onAnswerUserQuestion}
      {onDismissUserQuestion}
      {onAbort}
      {onModelChange}
      {onThinkingLevelChange}
      {onModeChange}
      {onPermissionChange}
      {onGrantApproval}
      {onDenyApproval}
      {onAcceptPlanReview}
      {onRequestPlanChanges}
      {onDiscardPlanReview}
    />
  {:else}
    <div class="empty-center">
      <Sparkles size={30} strokeWidth={1.7} />
      <p>No conversation open.</p>
      <span>Open a conversation from the left pane or start a new one.</span>
      <Button variant="secondary" size="sm" onclick={onOpenProject}>New conversation</Button>
    </div>
  {/if}
</section>

<style>
  .conversation-pane {
    display: grid;
    height: 100%;
    min-height: 0;
    grid-template-rows: minmax(0, 1fr) auto;
    background: var(--background);
  }

  .transcript {
    display: grid;
    align-content: start;
    gap: 0;
    min-height: 0;
    overflow: auto;
    padding: 0.75rem 0.75rem 1.1rem;
  }

  .transcript-entry {
    width: 100%;
    padding: 0.75rem;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 58%, transparent);
  }

  .transcript-entry.user {
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--primary) 8%, transparent);
    border-bottom-color: color-mix(in oklab, var(--primary) 18%, var(--border));
  }

  .message-body {
    position: relative;
    min-width: 0;
    overflow: hidden;
  }

  .message-body :global(.copy-btn) {
    position: absolute;
    top: 0;
    right: 0;
    opacity: 0;
  }

  .transcript-entry:hover .message-body :global(.copy-btn),
  .message-body :global(.copy-btn:focus-visible) {
    opacity: 1;
  }

  .message-content {
    min-width: 0;
    color: color-mix(in oklab, var(--foreground) 92%, transparent);
    font-size: 0.8125rem;
  }

  .streaming-content {
    position: relative;
  }

  .transcript-entry.user .message-content {
    color: var(--foreground);
  }

  .transcript-entry.streaming {
    border-color: var(--accent);
  }

  .stream-caret {
    display: inline-block;
    width: 0.42rem;
    height: 1em;
    margin-top: 0.18rem;
    background: var(--primary);
    animation: pulse 1s steps(2, start) infinite;
  }

  .empty-run,
  .empty-center {
    display: grid;
    place-content: center;
    min-height: 100%;
    color: var(--muted-foreground);
    text-align: center;
  }

  .empty-run,
  .empty-center {
    gap: 0.35rem;
    min-height: 22rem;
  }

  .empty-run :global(svg),
  .empty-center :global(svg) {
    color: var(--primary);
    justify-self: center;
  }

  .empty-run p,
  .empty-center p {
    margin: 0.25rem 0 0;
    color: var(--foreground);
  }

  .empty-center :global(.ui-button) {
    justify-self: center;
    margin-top: 0.45rem;
  }

  @keyframes pulse {
    50% { opacity: 0; }
  }
</style>

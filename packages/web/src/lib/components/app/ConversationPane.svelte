<script lang="ts">
  import Bot from "lucide-svelte/icons/bot";
  import Clipboard from "lucide-svelte/icons/clipboard";
  import FolderOpen from "lucide-svelte/icons/folder-open";
  import GitBranch from "lucide-svelte/icons/git-branch";
  import Radio from "lucide-svelte/icons/radio";
  import Sparkles from "lucide-svelte/icons/sparkles";
  import UserRound from "lucide-svelte/icons/user-round";
  import { toast } from "svelte-sonner";
  import type { AgentRecord, CompletionItem, ModelInfo, ProjectRecord, SessionEntry, SessionRecord } from "../../api";
  import Markdown from "../../Markdown.svelte";
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";
  import PromptComposer from "./PromptComposer.svelte";

  type TranscriptItem = {
    id?: string;
    role: "user" | "assistant" | "system";
    kind?: SessionEntry["kind"];
    text: string;
  };

  type Props = {
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
    activeAgent?: AgentRecord;
    transcript?: TranscriptItem[];
    streamingText?: string;
    live?: boolean;
    sending?: boolean;
    error?: string;
    composerText?: string;
    models?: ModelInfo[];
    selectedModelKey?: string;
    mode?: AgentRecord["mode"];
    permissionLevel?: AgentRecord["permissionLevel"];
    slashCompletions?: CompletionItem[];
    fileCompletions?: (query: string) => Promise<CompletionItem[]>;
    onComposerChange?: (value: string) => void;
    onSubmit?: () => void;
    onAbort?: () => void;
    onOpenProject?: () => void;
    onModelChange?: (value: string) => void;
    onModeChange?: (value: AgentRecord["mode"]) => void;
    onPermissionChange?: (value: AgentRecord["permissionLevel"]) => void;
  };

  let {
    activeProject,
    activeSession,
    activeAgent,
    transcript = [],
    streamingText = "",
    live = false,
    sending = false,
    error,
    composerText = "",
    models = [],
    selectedModelKey = "",
    mode = "coding",
    permissionLevel = "supervised",
    slashCompletions = [],
    fileCompletions,
    onComposerChange,
    onSubmit,
    onAbort,
    onOpenProject,
    onModelChange,
    onModeChange,
    onPermissionChange,
  }: Props = $props();

  function roleLabel(item: TranscriptItem) {
    if (item.kind && item.kind !== "message") return item.kind.replace("_", " ");
    if (item.role === "assistant") return "assistant";
    if (item.role === "system") return "context";
    return "you";
  }

  function roleIcon(role: TranscriptItem["role"]) {
    if (role === "assistant") return Bot;
    if (role === "system") return GitBranch;
    return UserRound;
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard?.writeText(text);
      toast.success("Copied message");
    } catch {
      toast.error("Could not copy message");
    }
  }
</script>

<section class="conversation-pane">
  {#if activeSession}
    <header class="conversation-header">
      <div class="title-block">
        <strong>{activeSession.title}</strong>
        <span title={activeProject?.dir}>{activeProject?.dir ?? "No project"}</span>
      </div>
      <div class="header-meta">
        <Badge tone={live ? "good" : "neutral"}>{#if live}<Radio size={12} />{/if}{live ? "live" : "offline"}</Badge>
        <Badge tone="accent">{activeAgent?.model ? `${activeAgent.model.provider}/${activeAgent.model.modelId}` : "model pending"}</Badge>
        <Badge tone="neutral">{activeAgent?.mode ?? mode}</Badge>
        <Badge tone="neutral">{activeAgent?.permissionLevel ?? permissionLevel}</Badge>
      </div>
    </header>

    <div class="transcript" aria-live="polite">
      {#if transcript.length === 0 && !streamingText}
        <div class="empty-run">
          <Sparkles size={34} strokeWidth={1.7} />
          <p>No messages yet.</p>
          <span>Write a prompt below to start this agent conversation.</span>
        </div>
      {/if}

      {#each transcript as item}
        {@const Icon = roleIcon(item.role)}
        <article class={`message-card ${item.role}`}>
          <div class="message-gutter">
            <span class="message-icon"><Icon size={14} strokeWidth={2.15} /></span>
          </div>
          <div class="message-body">
            <header class="message-head">
              <span>{roleLabel(item)}</span>
              <Button variant="icon" size="icon" ariaLabel="Copy message" title="Copy message" onclick={() => void copyText(item.text)}>
                <Clipboard size={12} strokeWidth={2.2} />
              </Button>
            </header>
            <div class="message-content">
              {#if item.role === "assistant" || item.role === "system"}
                <Markdown text={item.text} />
              {:else}
                <p>{item.text}</p>
              {/if}
            </div>
          </div>
        </article>
      {/each}

      {#if streamingText}
        <article class="message-card assistant streaming">
          <div class="message-gutter"><span class="message-icon"><Bot size={14} strokeWidth={2.15} /></span></div>
          <div class="message-body">
            <header class="message-head"><span>assistant</span><Badge tone="running">streaming</Badge></header>
            <div class="message-content"><p>{streamingText}<span class="stream-caret" aria-hidden="true"></span></p></div>
          </div>
        </article>
      {/if}
    </div>

    <PromptComposer
      text={composerText}
      {activeProject}
      {activeSession}
      {activeAgent}
      {live}
      {sending}
      {error}
      {models}
      {selectedModelKey}
      {mode}
      {permissionLevel}
      {slashCompletions}
      {fileCompletions}
      onChange={onComposerChange}
      {onSubmit}
      {onAbort}
      {onOpenProject}
      {onModelChange}
      {onModeChange}
      {onPermissionChange}
    />
  {:else}
    <div class="start-panel">
      <div class="start-card">
        <div class="start-icon"><Sparkles size={30} strokeWidth={1.8} /></div>
        <strong>Start an agent conversation</strong>
        <p>Select a local project directory. Nerve will create a coding agent conversation for that workspace.</p>
        <Button size="sm" onclick={onOpenProject}><FolderOpen size={13} strokeWidth={2.2} />Open project…</Button>
      </div>
    </div>
  {/if}
</section>

<style>
  .conversation-pane {
    display: grid;
    height: 100%;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr) auto;
    background: var(--color-bg);
  }

  .conversation-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 2.45rem;
    border-bottom: 1px solid var(--color-border-subtle);
    padding: 0.4rem 0.65rem;
    background: var(--color-panel-muted);
  }

  .title-block {
    display: grid;
    min-width: 0;
    gap: 0.05rem;
  }

  .title-block strong,
  .title-block span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title-block strong {
    font-size: 0.84rem;
    font-weight: 700;
  }

  .title-block span {
    color: var(--color-muted);
    font-size: 0.72rem;
  }

  .header-meta {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.35rem;
  }

  .transcript {
    display: grid;
    align-content: start;
    gap: 0.55rem;
    min-height: 0;
    overflow: auto;
    padding: 0.65rem 0.72rem 1rem;
  }

  .message-card {
    display: grid;
    grid-template-columns: 1.7rem minmax(0, 1fr);
    gap: 0.5rem;
  }

  .message-icon {
    display: inline-grid;
    width: 1.45rem;
    height: 1.45rem;
    place-items: center;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-muted);
  }

  .message-card.assistant .message-icon {
    color: var(--color-accent);
  }

  .message-card.user .message-icon {
    color: var(--color-text);
  }

  .message-body {
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
  }

  .message-card.user .message-body {
    background: var(--color-user-message);
  }

  .message-card.system .message-body {
    background: var(--color-panel-muted);
  }

  .message-card.streaming .message-body {
    border-color: var(--color-accent-soft);
    box-shadow: var(--shadow-glow);
  }

  .message-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 1.9rem;
    border-bottom: 1px solid var(--color-border-subtle);
    padding: 0.25rem 0.35rem 0.25rem 0.55rem;
    color: var(--color-muted);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .message-content {
    min-width: 0;
    color: var(--color-message-text);
    font-size: 0.9rem;
    padding: 0.6rem 0.65rem;
  }

  .message-content p {
    margin: 0;
    line-height: 1.52;
    white-space: pre-wrap;
  }

  .message-card.user .message-content {
    color: var(--color-text);
  }

  .stream-caret {
    display: inline-block;
    width: 0.45rem;
    height: 1em;
    margin-left: 0.18rem;
    transform: translateY(0.18em);
    background: var(--color-accent);
    animation: pulse 1s steps(2, start) infinite;
  }

  .empty-run,
  .start-panel {
    display: grid;
    place-content: center;
    min-height: 100%;
    color: var(--color-muted);
    text-align: center;
  }

  .empty-run {
    gap: 0.35rem;
    min-height: 22rem;
  }

  .empty-run :global(svg),
  .start-icon {
    color: var(--color-accent);
    justify-self: center;
  }

  .empty-run p,
  .start-panel p {
    margin: 0.25rem 0 0;
  }

  .start-panel {
    padding: 1rem;
  }

  .start-card {
    display: grid;
    justify-items: center;
    gap: 0.65rem;
    max-width: 28rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    padding: 1.5rem;
    box-shadow: var(--shadow-panel);
  }

  .start-panel strong {
    color: var(--color-text);
    font-size: 1rem;
  }

  @keyframes pulse {
    50% { opacity: 0; }
  }
</style>

<script lang="ts">
  import type { AgentRecord, CompletionItem, ModelInfo, ProjectRecord, SessionEntry, SessionRecord } from "../../api";
  import Markdown from "../../Markdown.svelte";
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
</script>

<section class="conversation-pane">
  {#if activeSession}
    <header class="conversation-header">
      <div class="title-block">
        <strong>{activeSession.title}</strong>
        <span title={activeProject?.dir}>{activeProject?.dir ?? "No project"}</span>
      </div>
      <div class="header-meta">
        <span>{activeAgent?.model ? `${activeAgent.model.provider}/${activeAgent.model.modelId}` : "model pending"}</span>
        <span>{activeAgent?.mode ?? mode}</span>
        <span>{activeAgent?.permissionLevel ?? permissionLevel}</span>
      </div>
    </header>

    <div class="transcript" aria-live="polite">
      {#if transcript.length === 0 && !streamingText}
        <div class="empty-run">
          <p>No messages yet.</p>
          <span>Write a prompt below to start this agent conversation.</span>
        </div>
      {/if}

      {#each transcript as item}
        <article class="message-row" class:user={item.role === "user"} class:system={item.role === "system"}>
          <div class="role">{item.role === "assistant" ? "ai" : item.role === "system" ? "ctx" : "you"}</div>
          <div class="content">
            {#if item.role === "assistant" || item.role === "system"}
              {#if item.kind && item.kind !== "message"}<span class="kind">{item.kind.replace("_", " ")}</span>{/if}
              <Markdown text={item.text} />
            {:else}
              <p>{item.text}</p>
            {/if}
          </div>
        </article>
      {/each}

      {#if streamingText}
        <article class="message-row streaming">
          <div class="role">ai</div>
          <div class="content"><p>{streamingText}</p></div>
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
      <div>
        <strong>Start an agent conversation</strong>
        <p>Select a project directory. Nerve will create a coding agent conversation for that project.</p>
      </div>
      <Button size="sm" onclick={onOpenProject}>Open project…</Button>
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
    min-height: 2.25rem;
    border-bottom: 1px solid var(--color-border-subtle);
    padding: 0.35rem 0.6rem;
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
    font-size: 0.82rem;
    font-weight: 650;
  }

  .title-block span,
  .header-meta {
    color: var(--color-muted);
    font-size: 0.72rem;
  }

  .header-meta {
    display: flex;
    flex: none;
    gap: 0.55rem;
  }

  .transcript {
    min-height: 0;
    overflow: auto;
    padding: 0.55rem 0.65rem 1rem;
  }

  .message-row {
    display: grid;
    grid-template-columns: 2.25rem minmax(0, 1fr);
    gap: 0.55rem;
    padding: 0.38rem 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .role {
    color: var(--color-muted);
    font-size: 0.7rem;
    font-weight: 650;
    line-height: 1.55;
    text-align: right;
    text-transform: lowercase;
  }

  .content {
    min-width: 0;
    color: var(--color-message-text);
    font-size: 0.9rem;
  }

  .content p {
    margin: 0;
    line-height: 1.52;
    white-space: pre-wrap;
  }

  .message-row.user .content {
    color: var(--color-text);
  }

  .message-row.streaming {
    border-left: 2px solid var(--color-accent);
    padding-left: 0.35rem;
  }

  .kind {
    display: inline-block;
    margin-bottom: 0.25rem;
    color: var(--color-accent);
    font-size: 0.7rem;
  }

  .empty-run,
  .start-panel {
    display: grid;
    place-content: center;
    height: 100%;
    color: var(--color-muted);
    text-align: center;
  }

  .empty-run p,
  .start-panel p {
    margin: 0.25rem 0 0;
  }

  .start-panel {
    gap: 0.8rem;
    grid-template-rows: auto auto;
    padding: 1rem;
  }

  .start-panel strong {
    color: var(--color-text);
  }
</style>

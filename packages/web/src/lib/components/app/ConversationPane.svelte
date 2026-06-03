<script lang="ts">
  import Bot from "lucide-svelte/icons/bot";
  import ChevronsRight from "lucide-svelte/icons/chevrons-right";
  import Clipboard from "lucide-svelte/icons/clipboard";
  import Copy from "lucide-svelte/icons/copy";
  import Info from "lucide-svelte/icons/info";
  import Sparkles from "lucide-svelte/icons/sparkles";
  import TextQuote from "lucide-svelte/icons/text-quote";
  import { toast } from "svelte-sonner";
  import type { AgentRecord, ApprovalWithToolCall, CompletionItem, ModelInfo, ProjectRecord, SessionEntry, SessionRecord } from "../../api";
  import Markdown from "../../Markdown.svelte";
  import Button from "../ui/Button.svelte";
  import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu.svelte";
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
    projects?: ProjectRecord[];
    sessions?: SessionRecord[];
    agents?: AgentRecord[];
    homeDir?: string;
    approvals?: ApprovalWithToolCall[];
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
    onNewConversationInProject?: (projectDir: string) => void;
    onModelChange?: (value: string) => void;
    onModeChange?: (value: AgentRecord["mode"]) => void;
    onPermissionChange?: (value: AgentRecord["permissionLevel"]) => void;
    onGrantApproval?: (id: string) => void;
    onDenyApproval?: (id: string) => void;
  };

  let {
    activeProject,
    activeSession,
    activeAgent,
    approvals = [],
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
    onGrantApproval,
    onDenyApproval,
  }: Props = $props();

  function roleLabel(item: TranscriptItem) {
    if (item.kind && item.kind !== "message") return item.kind.replace("_", " ");
    if (item.role === "assistant") return "assistant";
    if (item.role === "system") return "context";
    return "you";
  }

  function roleIcon(role: TranscriptItem["role"]) {
    if (role === "assistant") return Bot;
    if (role === "system") return Info;
    return ChevronsRight;
  }

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
      {#if transcript.length === 0 && !streamingText}
        <div class="empty-run">
          <Sparkles size={28} strokeWidth={1.7} />
          <p>No messages yet.</p>
          <span>Write a prompt below to start this agent conversation.</span>
        </div>
      {/if}

      {#each transcript as item}
        {@const Icon = roleIcon(item.role)}
        <ContextMenu items={messageMenu(item)}>
          <article class={`transcript-entry ${item.role}`}>
            <div class="message-gutter">
              <span class="message-icon" title={roleLabel(item)}><Icon size={item.role === "user" ? 18 : 14} strokeWidth={2.1} /></span>
            </div>
            <div class="message-body">
              <div class="message-content">
                {#if item.role === "assistant" || item.role === "system"}
                  <Markdown text={item.text} />
                {:else}
                  <p>{item.text}</p>
                {/if}
              </div>
              <Button class="copy-btn" variant="icon" size="icon" ariaLabel="Copy message" title="Copy message" onclick={() => void copyText(item.text)}>
                <Clipboard size={12} strokeWidth={2.2} />
              </Button>
            </div>
          </article>
        </ContextMenu>
      {/each}

      {#if streamingText}
        <article class="transcript-entry assistant streaming">
          <div class="message-gutter"><span class="message-icon" title="assistant"><Bot size={14} strokeWidth={2.1} /></span></div>
          <div class="message-body">
            <div class="message-content"><p>{streamingText}<span class="stream-caret" aria-hidden="true"></span></p></div>
          </div>
        </article>
      {/if}
    </div>

    <PromptComposer
      text={composerText}
      {activeProject}
      {activeSession}
      {approvals}
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
      {onModelChange}
      {onModeChange}
      {onPermissionChange}
      {onGrantApproval}
      {onDenyApproval}
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
    background: hsl(var(--background));
  }

  .transcript {
    display: grid;
    align-content: start;
    gap: 0;
    min-height: 0;
    overflow: auto;
    padding: 0.9rem 0.95rem 1.2rem;
  }

  .transcript-entry {
    display: grid;
    grid-template-columns: 1.8rem minmax(0, 1fr);
    gap: 0.55rem;
    max-width: 920px;
    width: 100%;
    margin: 0 auto;
    padding: 0.8rem 0;
    border-bottom: 1px solid hsl(var(--border) / 0.6);
  }

  .message-gutter {
    position: relative;
    display: grid;
    justify-items: center;
    padding-top: 0.1rem;
  }

  .message-icon {
    display: inline-grid;
    width: 1.5rem;
    height: 1.5rem;
    place-items: center;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: hsl(var(--muted-foreground));
  }

  .transcript-entry.user .message-icon {
    color: hsl(var(--primary));
  }

  .transcript-entry.assistant .message-icon {
    border-color: hsl(var(--border));
    background: hsl(var(--secondary));
    color: hsl(var(--foreground));
  }

  .transcript-entry.system .message-icon {
    color: hsl(var(--muted-foreground) / 0.75);
  }

  .message-body {
    position: relative;
    min-width: 0;
    overflow: hidden;
    padding-top: 0.12rem;
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
    color: hsl(var(--foreground) / 0.92);
    font-size: var(--text-sm);
  }

  .message-content p {
    margin: 0;
    line-height: var(--leading-relaxed);
    white-space: pre-wrap;
  }

  .transcript-entry.user .message-content {
    color: hsl(var(--foreground));
  }

  .transcript-entry.streaming {
    border-color: hsl(var(--accent));
  }

  .stream-caret {
    display: inline-block;
    width: 0.42rem;
    height: 1em;
    margin-left: 0.18rem;
    transform: translateY(0.18em);
    background: hsl(var(--primary));
    animation: pulse 1s steps(2, start) infinite;
  }

  .empty-run,
  .empty-center {
    display: grid;
    place-content: center;
    min-height: 100%;
    color: hsl(var(--muted-foreground));
    text-align: center;
  }

  .empty-run,
  .empty-center {
    gap: 0.35rem;
    min-height: 22rem;
  }

  .empty-run :global(svg),
  .empty-center :global(svg) {
    color: hsl(var(--primary));
    justify-self: center;
  }

  .empty-run p,
  .empty-center p {
    margin: 0.25rem 0 0;
    color: hsl(var(--foreground));
  }

  .empty-center :global(.ui-button) {
    justify-self: center;
    margin-top: 0.45rem;
  }

  @keyframes pulse {
    50% { opacity: 0; }
  }
</style>

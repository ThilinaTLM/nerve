<script lang="ts">
  import Bot from "lucide-svelte/icons/bot";
  import FolderOpen from "lucide-svelte/icons/folder-open";
  import Shield from "lucide-svelte/icons/shield";
  import SlidersHorizontal from "lucide-svelte/icons/sliders-horizontal";
  import Sparkles from "lucide-svelte/icons/sparkles";
  import Square from "lucide-svelte/icons/square";
  import type { AgentRecord, CompletionItem, ModelInfo, ProjectRecord, SessionRecord } from "../../api";
  import Button from "../ui/Button.svelte";
  import Badge from "../ui/Badge.svelte";
  import Kbd from "../ui/Kbd.svelte";
  import Select, { type SelectItem } from "../ui/Select.svelte";
  import CodeMirrorComposer from "../../CodeMirrorComposer.svelte";

  type Mode = AgentRecord["mode"];
  type PermissionLevel = AgentRecord["permissionLevel"];

  type Props = {
    text?: string;
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
    activeAgent?: AgentRecord;
    live?: boolean;
    sending?: boolean;
    error?: string;
    models?: ModelInfo[];
    selectedModelKey?: string;
    mode?: Mode;
    permissionLevel?: PermissionLevel;
    slashCompletions?: CompletionItem[];
    fileCompletions?: (query: string) => Promise<CompletionItem[]>;
    onChange?: (value: string) => void;
    onSubmit?: () => void;
    onAbort?: () => void;
    onOpenProject?: () => void;
    onModelChange?: (value: string) => void;
    onModeChange?: (value: Mode) => void;
    onPermissionChange?: (value: PermissionLevel) => void;
  };

  let {
    text = "",
    activeProject,
    activeSession,
    activeAgent,
    live = false,
    sending = false,
    error,
    models = [],
    selectedModelKey = "",
    mode = "coding",
    permissionLevel = "supervised",
    slashCompletions = [],
    fileCompletions,
    onChange,
    onSubmit,
    onAbort,
    onOpenProject,
    onModelChange,
    onModeChange,
    onPermissionChange,
  }: Props = $props();

  const canPrompt = $derived(Boolean(activeProject && activeSession && live && models.length > 0));
  const modelItems = $derived<SelectItem[]>(models.length
    ? models.map((model) => ({
      value: `${model.provider}:${model.modelId}`,
      label: model.label,
      detail: model.provider,
    }))
    : [{ value: "", label: "No configured models", detail: "Run nerve auth list", disabled: true }]);

  const modeItems: SelectItem[] = [
    { value: "coding", label: "Coding", detail: "Implement and modify files" },
    { value: "planning", label: "Planning", detail: "Read and prepare before edits" },
  ];

  const permissionItems: SelectItem[] = [
    { value: "read_only", label: "Read only", detail: "No writes or commands that mutate" },
    { value: "supervised", label: "Supervised", detail: "Ask before sensitive actions" },
    { value: "autonomous", label: "Autonomous", detail: "Proceed with broader authority" },
  ];

  function statusTone(status: string | undefined): "neutral" | "accent" | "good" | "warn" | "danger" | "running" {
    if (status === "running") return "running";
    if (status === "error") return "danger";
    if (status === "completed") return "good";
    return "neutral";
  }
</script>

<form class="composer" onsubmit={(event) => { event.preventDefault(); onSubmit?.(); }}>
  <div class="composer-toolbar">
    <div class="control-group model-control">
      <span><Sparkles size={12} strokeWidth={2.25} />Model</span>
      <Select
        items={modelItems}
        bind:value={selectedModelKey}
        ariaLabel="Model"
        disabled={!activeSession || sending || models.length === 0}
        onValueChange={(value) => onModelChange?.(value)}
      />
    </div>

    <div class="control-group mode-control">
      <span><SlidersHorizontal size={12} strokeWidth={2.25} />Mode</span>
      <Select
        items={modeItems}
        value={mode}
        ariaLabel="Mode"
        disabled={!activeSession || sending}
        onValueChange={(value) => onModeChange?.(value as Mode)}
      />
    </div>

    <div class="control-group permission-control">
      <span><Shield size={12} strokeWidth={2.25} />Access</span>
      <Select
        items={permissionItems}
        value={permissionLevel}
        ariaLabel="Permission level"
        disabled={!activeSession || sending}
        onValueChange={(value) => onPermissionChange?.(value as PermissionLevel)}
      />
    </div>

    <Button variant="toolbar" size="sm" class="project-pill" onclick={onOpenProject} title={activeProject?.dir ?? "Open project"}>
      <FolderOpen size={13} strokeWidth={2.2} />
      <span>{activeProject ? activeProject.name : "open project"}</span>
    </Button>

    {#if activeAgent?.status}
      <Badge tone={statusTone(activeAgent.status)}><Bot size={12} strokeWidth={2.25} />{activeAgent.status}</Badge>
    {/if}
  </div>

  <div class="editor-shell">
    <CodeMirrorComposer
      value={text}
      disabled={sending || !canPrompt}
      {slashCompletions}
      {fileCompletions}
      onChange={onChange}
      onSubmit={onSubmit}
    />
  </div>

  <div class="composer-footer">
    <span class="footer-hint">
      {#if !activeSession}
        Select a project to start.
      {:else if models.length === 0}
        Configure a provider from the CLI: <code>nerve auth list</code>.
      {:else if !live}
        Daemon is {activeSession ? "not live" : "offline"}.
      {:else}
        <Kbd>⌘</Kbd><Kbd>Enter</Kbd> sends · <Kbd>/</Kbd> commands · <Kbd>@</Kbd> files
      {/if}
    </span>
    <div class="actions">
      {#if sending}
        <Button variant="secondary" size="sm" onclick={onAbort}><Square size={12} strokeWidth={2.4} />Abort</Button>
      {/if}
      <Button size="sm" type="submit" disabled={sending || !canPrompt}>{sending ? "Running" : "Send"}</Button>
    </div>
  </div>

  {#if error}<p class="composer-error">{error}</p>{/if}
</form>

<style>
  .composer {
    display: grid;
    gap: 0.45rem;
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-panel-muted);
    padding: 0.5rem;
    box-shadow: 0 -1px 0 rgb(255 255 255 / 3%) inset;
  }

  .composer-toolbar,
  .composer-footer,
  .actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .composer-toolbar {
    min-width: 0;
    flex-wrap: wrap;
  }

  .control-group {
    display: grid;
    min-width: 7.5rem;
    gap: 0.15rem;
  }

  .model-control {
    min-width: min(18rem, 34vw);
  }

  .mode-control,
  .permission-control {
    min-width: 8.5rem;
  }

  .control-group > span {
    display: flex;
    align-items: center;
    gap: 0.22rem;
    color: var(--color-muted);
    font-size: 0.66rem;
    font-weight: 650;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  :global(.project-pill) {
    align-self: end;
    max-width: 15rem;
  }

  :global(.project-pill) span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .editor-shell {
    min-width: 0;
  }

  .composer-footer {
    justify-content: space-between;
    color: var(--color-muted);
    font-size: 0.72rem;
  }

  .footer-hint {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.22rem;
    min-width: 0;
  }

  .footer-hint code {
    color: var(--color-code);
  }

  .composer-error {
    margin: 0;
    border: 1px solid var(--color-danger-soft);
    border-radius: var(--radius-sm);
    background: var(--color-danger-soft);
    color: var(--color-danger);
    padding: 0.4rem 0.5rem;
    font-size: 0.78rem;
  }
</style>

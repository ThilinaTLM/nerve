<script lang="ts">
  import type { AgentRecord, CompletionItem, ModelInfo, ProjectRecord, SessionRecord } from "../../api";
  import Button from "../ui/Button.svelte";
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
</script>

<form class="composer" onsubmit={(event) => { event.preventDefault(); onSubmit?.(); }}>
  <div class="composer-toolbar">
    <select
      aria-label="Model"
      disabled={!activeSession || sending || models.length === 0}
      value={selectedModelKey}
      onchange={(event) => onModelChange?.((event.currentTarget as HTMLSelectElement).value)}
    >
      {#if models.length === 0}
        <option value="">No configured models</option>
      {:else}
        {#each models as model}
          <option value={`${model.provider}:${model.modelId}`}>{model.label}</option>
        {/each}
      {/if}
    </select>

    <select
      aria-label="Mode"
      disabled={!activeSession || sending}
      value={mode}
      onchange={(event) => onModeChange?.((event.currentTarget as HTMLSelectElement).value as Mode)}
    >
      <option value="coding">coding</option>
      <option value="planning">planning</option>
    </select>

    <select
      aria-label="Permission level"
      disabled={!activeSession || sending}
      value={permissionLevel}
      onchange={(event) => onPermissionChange?.((event.currentTarget as HTMLSelectElement).value as PermissionLevel)}
    >
      <option value="read_only">read only</option>
      <option value="supervised">supervised</option>
      <option value="autonomous">autonomous</option>
    </select>

    <button class="project-pill" type="button" onclick={onOpenProject} title={activeProject?.dir ?? "Open project"}>
      {activeProject ? activeProject.name : "open project"}
    </button>

    {#if activeAgent?.status}
      <span class={`agent-status ${activeAgent.status}`}>{activeAgent.status}</span>
    {/if}
  </div>

  <CodeMirrorComposer
    value={text}
    disabled={sending || !canPrompt}
    {slashCompletions}
    {fileCompletions}
    onChange={onChange}
    onSubmit={onSubmit}
  />

  <div class="composer-footer">
    <span>
      {#if !activeSession}
        Select a project to start.
      {:else if models.length === 0}
        Configure a provider from the CLI: nerve auth list.
      {:else if !live}
        Daemon is {" "}{activeSession ? "not live" : "offline"}.
      {:else}
        ⌘ Enter sends · / commands · @ files
      {/if}
    </span>
    <div class="actions">
      {#if sending}<Button variant="secondary" size="sm" onclick={onAbort}>Abort</Button>{/if}
      <Button size="sm" type="submit" disabled={sending || !canPrompt}>{sending ? "Running" : "Send"}</Button>
    </div>
  </div>

  {#if error}<p class="composer-error">{error}</p>{/if}
</form>

<style>
  .composer {
    display: grid;
    gap: 0.4rem;
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-panel-muted);
    padding: 0.5rem;
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
  }

  select,
  .project-pill {
    height: 1.7rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0 0.45rem;
    font-size: 0.75rem;
  }

  select:disabled {
    opacity: 0.55;
  }

  .project-pill {
    overflow: hidden;
    max-width: 16rem;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .project-pill:hover {
    background: var(--color-panel-raised);
  }

  .agent-status {
    margin-left: auto;
    color: var(--color-muted);
    font-size: 0.72rem;
  }

  .agent-status.running {
    color: var(--color-accent);
  }

  .composer-footer {
    justify-content: space-between;
    color: var(--color-muted);
    font-size: 0.72rem;
  }

  .composer-error {
    margin: 0;
    color: var(--color-danger);
    font-size: 0.78rem;
  }
</style>

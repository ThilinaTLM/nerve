<script lang="ts">
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Loader from "@lucide/svelte/icons/loader-circle";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Wrench from "@lucide/svelte/icons/wrench";
  import type { AuthProviderMetadata, Settings, StatusResponse, UpdateSettingsRequest } from "$lib/api";
  import {
    deleteProviderCredential,
    getAuthProviders,
    getCredentialKey,
    setProviderApiKey,
  } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import ConfirmDialog from "$lib/components/ui/confirm-dialog";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Input } from "$lib/components/ui/input";
  import { Switch as ToggleSwitch } from "$lib/components/ui/switch";
  import { encryptApiKey } from "$lib/core/utils/credential-crypto";
  import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
  import SettingsSectionCard from "../SettingsSectionCard.svelte";
  import JiraToolsSettingsCard from "./JiraToolsSettingsCard.svelte";

  type SettingsChange = (
    patch: UpdateSettingsRequest,
    options?: { immediate?: boolean; debounceMs?: number },
  ) => void;
  type ConfigurableToolName = Settings["tools"]["disabled"][number];
  type ToolSummary = { name: string; description: string };

  type Props = {
    settingsDraft: Settings;
    status?: StatusResponse;
    authProviders?: AuthProviderMetadata[];
    onSettingsChange?: SettingsChange;
  };

  const tavilyProviderId = "tavily";
  const configurableToolOrder: ConfigurableToolName[] = [
    "web_search",
    "web_fetch",
    "python",
  ];

  const fileInspectionTools: ToolSummary[] = [
    { name: "read", description: "Read text files or images with bounded output." },
    { name: "ls", description: "List directory entries sorted alphabetically, including dotfiles." },
    { name: "find", description: "Find files by glob pattern while respecting .gitignore." },
    { name: "grep", description: "Search file contents with regex or literal patterns." },
  ];
  const fileEditingTools: ToolSummary[] = [
    { name: "write", description: "Create or overwrite files when workspace writes are allowed." },
    { name: "edit", description: "Patch existing files with replacements, insertions, or diffs." },
  ];
  const planModeTools: ToolSummary[] = [
    { name: "plan_mode_enter", description: "Enter review-first planning before design-heavy edits." },
    { name: "plan_mode_present", description: "Present a completed plan for user approval." },
    { name: "plan_mode_force_exit", description: "Exit plan mode after approval or cancellation." },
  ];
  const todoTools: ToolSummary[] = [
    { name: "todos_set", description: "Set the current task checklist." },
    { name: "todos_get", description: "Read the current task checklist." },
  ];
  const webTools: ToolSummary[] = [
    { name: "web_search", description: "Search the web through Tavily for current information." },
    { name: "web_fetch", description: "Fetch a URL and convert HTML to readable markdown." },
  ];
  const taskTools: ToolSummary[] = [
    { name: "task_start", description: "Start long-lived commands such as servers or watchers." },
    { name: "task_status", description: "Inspect supervised background task state." },
    { name: "task_logs", description: "Read recent, warning, error, or filtered task logs." },
    { name: "task_cancel", description: "Terminate a running or orphaned background task." },
    { name: "task_restart", description: "Restart a task with its saved launch settings." },
    { name: "task_list", description: "List known background tasks for the project." },
  ];
  const shellTools: ToolSummary[] = [
    { name: "bash", description: "Run finite checks, tests, builds, and shell commands." },
  ];
  const pythonTools: ToolSummary[] = [
    { name: "python", description: "Run short Python scripts or files for data work." },
  ];

  let {
    settingsDraft,
    status,
    authProviders = [],
    onSettingsChange,
  }: Props = $props();

  let tavilyApiKey = $state("");
  let tavilyBusy = $state(false);
  let tavilyError = $state<string | undefined>(undefined);
  let tavilyMessage = $state<string | undefined>(undefined);
  let tavilyDialogOpen = $state(false);
  let removeTavilyOpen = $state(false);
  let pythonDialogOpen = $state(false);
  let pythonPathDraft = $state("");

  const disabledTools = $derived(new Set(settingsDraft.tools?.disabled ?? []));
  const webEnabled = $derived(
    !disabledTools.has("web_search") && !disabledTools.has("web_fetch"),
  );
  const pythonEnabled = $derived(!disabledTools.has("python"));
  const python = $derived(status?.runtime.python);
  const manualPath = $derived(settingsDraft.runtime?.pythonExecutablePath ?? "");
  const sourceLabel = $derived((python?.source ?? "unavailable").replace(/_/g, " "));
  const tavilyProvider = $derived(
    authProviders.find((provider) => provider.provider === tavilyProviderId),
  );
  const tavilyConfigured = $derived(
    tavilyProvider?.configured && tavilyProvider.credentialType === "api_key",
  );
  const tavilyDisplayName = $derived(tavilyProvider?.displayName ?? "Tavily");

  function setToolsEnabled(
    names: ConfigurableToolName[],
    enabled: boolean,
  ) {
    settingsDraft.tools ??= { disabled: [], jira: { enabled: false } };
    const next = new Set(settingsDraft.tools.disabled);
    for (const name of names) {
      if (enabled) next.delete(name);
      else next.add(name);
    }
    const disabled = configurableToolOrder.filter((name) => next.has(name));
    settingsDraft.tools.disabled = disabled;
    onSettingsChange?.({ tools: { disabled } }, { immediate: true });
  }

  function openTavilyDialog() {
    tavilyApiKey = "";
    tavilyError = undefined;
    tavilyMessage = undefined;
    tavilyDialogOpen = true;
  }

  function openPythonRuntimeDialog() {
    pythonPathDraft = manualPath;
    pythonDialogOpen = true;
  }

  function savePythonPath() {
    const next = pythonPathDraft.trim().length > 0 ? pythonPathDraft : undefined;
    settingsDraft.runtime ??= {};
    settingsDraft.runtime.pythonExecutablePath = next;
    onSettingsChange?.(
      { runtime: { pythonExecutablePath: next ?? null } },
      { immediate: true },
    );
    pythonDialogOpen = false;
  }

  function resetPythonPath() {
    pythonPathDraft = "";
    settingsDraft.runtime ??= {};
    settingsDraft.runtime.pythonExecutablePath = undefined;
    onSettingsChange?.(
      { runtime: { pythonExecutablePath: null } },
      { immediate: true },
    );
    pythonDialogOpen = false;
  }

  async function refreshAuthProviders() {
    settingsState.authProviders = await getAuthProviders();
  }

  async function saveTavilyKey() {
    const trimmed = tavilyApiKey.trim();
    if (!trimmed) return;
    tavilyBusy = true;
    tavilyError = undefined;
    tavilyMessage = undefined;
    try {
      const credentialKey = await getCredentialKey();
      const envelope = await encryptApiKey(trimmed, credentialKey);
      await setProviderApiKey(tavilyProviderId, envelope);
      tavilyApiKey = "";
      tavilyMessage = `${tavilyDisplayName} API key saved.`;
      await refreshAuthProviders();
    } catch (err) {
      tavilyError = err instanceof Error ? err.message : String(err);
    } finally {
      tavilyBusy = false;
    }
  }

  async function removeTavilyKey() {
    tavilyBusy = true;
    tavilyError = undefined;
    tavilyMessage = undefined;
    try {
      await deleteProviderCredential(tavilyProviderId);
      tavilyApiKey = "";
      tavilyMessage = `${tavilyDisplayName} API key removed.`;
      await refreshAuthProviders();
    } catch (err) {
      tavilyError = err instanceof Error ? err.message : String(err);
    } finally {
      tavilyBusy = false;
      removeTavilyOpen = false;
    }
  }
</script>

{#snippet alwaysOnSwitch(label: string)}
  <ToggleSwitch checked disabled aria-label={label} />
{/snippet}

{#snippet webSwitch()}
  <ToggleSwitch
    checked={webEnabled}
    aria-label="Enable web access tools"
    onCheckedChange={(checked) => setToolsEnabled(["web_search", "web_fetch"], checked)}
  />
{/snippet}

{#snippet pythonSwitch()}
  <ToggleSwitch
    checked={pythonEnabled}
    aria-label="Enable Python tool"
    onCheckedChange={(checked) => setToolsEnabled(["python"], checked)}
  />
{/snippet}

{#snippet toolList(tools: ToolSummary[])}
  <ul class="settings-tool-list" aria-label="Tools in this group">
    {#each tools as tool}
      <li class="settings-tool-item">
        <Wrench size={13} strokeWidth={2} aria-hidden="true" />
        <span><code>{tool.name}</code>{tool.description}</span>
      </li>
    {/each}
  </ul>
{/snippet}

<SettingsSectionCard
  section="tools-file-inspection"
  title="File inspection"
  description="Read, list, find, and search workspace files without modifying them."
>
  {#snippet actions()}{@render alwaysOnSwitch("File inspection tools are always enabled")}{/snippet}
  {@render toolList(fileInspectionTools)}
</SettingsSectionCard>

<SettingsSectionCard
  section="tools"
  title="File editing"
  description="Create and modify workspace files when the agent policy permits writes."
>
  {#snippet actions()}{@render alwaysOnSwitch("File editing tools are always enabled")}{/snippet}
  {@render toolList(fileEditingTools)}
</SettingsSectionCard>

<SettingsSectionCard
  section="tools-plan-mode"
  title="Plan mode"
  description="Research, draft, and present implementation plans before workspace changes."
>
  {#snippet actions()}{@render alwaysOnSwitch("Plan mode tools are always enabled")}{/snippet}
  {@render toolList(planModeTools)}
</SettingsSectionCard>

<SettingsSectionCard
  section="tools-todos"
  title="Todos"
  description="Track multi-step work with a lightweight checklist for the current task."
>
  {#snippet actions()}{@render alwaysOnSwitch("Todo tools are always enabled")}{/snippet}
  {@render toolList(todoTools)}
</SettingsSectionCard>

<SettingsSectionCard
  section="tools-web"
  title="Web access"
  description="Search the web and fetch URLs for external context."
>
  {#snippet actions()}{@render webSwitch()}{/snippet}
  {@render toolList(webTools)}

  <div class="settings-credential-summary">
    <div class="settings-copy">
      <strong>Tavily API key</strong>
      <span>{tavilyConfigured ? "•••••••• configured" : "Required for web_search."}</span>
    </div>
    <Button size="sm" variant="outline" onclick={openTavilyDialog}>{tavilyConfigured ? "Configure key" : "Add key"}</Button>
  </div>

  {#if tavilyError}
    <p class="settings-inline-message" data-tone="error">
      <TriangleAlert size={14} strokeWidth={2} />
      {tavilyError}
    </p>
  {:else if tavilyMessage}
    <p class="settings-inline-message" data-tone="success">
      <CircleCheck size={14} strokeWidth={2} />
      {tavilyMessage}
    </p>
  {/if}
</SettingsSectionCard>

<JiraToolsSettingsCard {settingsDraft} {authProviders} {onSettingsChange} />

<SettingsSectionCard
  section="tools-tasks"
  title="Task management"
  description="Start, supervise, inspect, restart, and cancel background commands."
>
  {#snippet actions()}{@render alwaysOnSwitch("Task management tools are always enabled")}{/snippet}
  {@render toolList(taskTools)}
</SettingsSectionCard>

<SettingsSectionCard
  section="tools-shell"
  title="Shell"
  description="Run finite shell commands for checks, tests, builds, and project scripts."
>
  {#snippet actions()}{@render alwaysOnSwitch("Shell tool is always enabled")}{/snippet}
  {@render toolList(shellTools)}
</SettingsSectionCard>

<SettingsSectionCard
  section="tools-python"
  title="Python"
  description="Run short Python scripts or files for data processing and analysis."
>
  {#snippet actions()}{@render pythonSwitch()}{/snippet}
  {@render toolList(pythonTools)}

  <div class="settings-runtime-summary">
    <div class="settings-copy">
      <strong>{python?.available ? "Runtime available" : "Runtime unavailable"}</strong>
      <span>
        {#if python?.available}
          {python.version ?? "Unknown version"} · {sourceLabel} · <code>{python.executable ?? "No executable"}</code>
        {:else}
          {python?.error ?? "No Python runtime was detected."}
        {/if}
      </span>
    </div>
    <Button size="sm" variant="outline" onclick={openPythonRuntimeDialog}>Configure runtime</Button>
  </div>

  <p class="settings-note">Planning-mode Python runs with file-write guardrails. This is not a hard security sandbox.</p>
</SettingsSectionCard>

<Dialog.Root bind:open={tavilyDialogOpen}>
  <Dialog.Content class="settings-runtime-dialog">
    <Dialog.Header>
      <Dialog.Title>Configure Tavily API key</Dialog.Title>
      <Dialog.Description>
        Store a Tavily API key for the web_search tool. The key is encrypted before it is sent to the daemon.
      </Dialog.Description>
    </Dialog.Header>

    <form
      class="settings-dialog-body"
      onsubmit={(event) => {
        event.preventDefault();
        void saveTavilyKey();
      }}
    >
      <label class="settings-key-label" for="tools-tavily-key">
        <span><KeyRound size={13} strokeWidth={2} /> Tavily API key</span>
        <Input
          id="tools-tavily-key"
          type="password"
          autocomplete="off"
          placeholder={tavilyConfigured ? "Paste a replacement key" : "Paste your Tavily API key"}
          bind:value={tavilyApiKey}
          disabled={tavilyBusy}
        />
      </label>

      {#if tavilyConfigured}
        <p class="settings-dialog-note">Current key: <code>•••••••• configured</code></p>
      {/if}

      {#if tavilyError}
        <p class="settings-inline-message" data-tone="error">
          <TriangleAlert size={14} strokeWidth={2} />
          {tavilyError}
        </p>
      {:else if tavilyMessage}
        <p class="settings-inline-message" data-tone="success">
          <CircleCheck size={14} strokeWidth={2} />
          {tavilyMessage}
        </p>
      {/if}

      <Dialog.Footer>
        <Button type="button" variant="ghost" onclick={() => (tavilyDialogOpen = false)}>Close</Button>
        {#if tavilyConfigured}
          <Button type="button" variant="outline" disabled={tavilyBusy} onclick={() => (removeTavilyOpen = true)}>Remove key</Button>
        {/if}
        <Button type="submit" disabled={tavilyBusy || tavilyApiKey.trim().length === 0}>
          {#if tavilyBusy}
            <Loader size={14} strokeWidth={2} class="animate-spin" />
          {/if}
          {tavilyConfigured ? "Replace key" : "Save key"}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={pythonDialogOpen}>
  <Dialog.Content class="settings-runtime-dialog">
    <Dialog.Header>
      <Dialog.Title>Configure Python runtime</Dialog.Title>
      <Dialog.Description>
        Set a manual Python executable path, or leave it empty to auto-detect from the project and system PATH.
      </Dialog.Description>
    </Dialog.Header>

    <div class="settings-dialog-body">
      <label class="settings-key-label" for="tools-python-executable">
        <span>Python executable</span>
        <Input
          id="tools-python-executable"
          bind:value={pythonPathDraft}
          placeholder="Auto-detect"
          ariaLabel="Python executable path"
        />
      </label>
      {#if python?.executable}
        <p class="settings-dialog-note">Current executable: <code>{python.executable}</code></p>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (pythonDialogOpen = false)}>Cancel</Button>
      <Button variant="outline" onclick={resetPythonPath}>Use auto-detect</Button>
      <Button onclick={savePythonPath}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  open={removeTavilyOpen}
  title="Remove Tavily API key?"
  description="This disables web search until another Tavily key is configured. The Web access module setting is not changed."
  confirmLabel="Remove"
  destructive
  onConfirm={() => void removeTavilyKey()}
  onOpenChange={(open) => {
    removeTavilyOpen = open;
  }}
/>

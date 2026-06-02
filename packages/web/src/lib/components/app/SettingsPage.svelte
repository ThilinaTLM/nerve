<script lang="ts">
  import ArrowLeft from "lucide-svelte/icons/arrow-left";
  import Bot from "lucide-svelte/icons/bot";
  import KeyRound from "lucide-svelte/icons/key-round";
  import Monitor from "lucide-svelte/icons/monitor";
  import RefreshCw from "lucide-svelte/icons/refresh-cw";
  import Save from "lucide-svelte/icons/save";
  import Server from "lucide-svelte/icons/server";
  import Settings2 from "lucide-svelte/icons/settings-2";
  import Shield from "lucide-svelte/icons/shield";
  import SlidersHorizontal from "lucide-svelte/icons/sliders-horizontal";
  import Sparkles from "lucide-svelte/icons/sparkles";
  import type { AuthProviderMetadata, Settings, StatusResponse } from "../../api";
  import type { ThemePreference } from "../../state/app-state.svelte";
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";
  import Input from "../ui/Input.svelte";
  import RadioGroup from "../ui/RadioGroup.svelte";
  import ScrollArea from "../ui/ScrollArea.svelte";
  import Switch from "../ui/Switch.svelte";

  type RadioItem = {
    value: string;
    label: string;
    detail?: string;
    disabled?: boolean;
  };

  type SettingsSection = "general" | "appearance" | "providers" | "agents" | "network";

  type Props = {
    status?: StatusResponse;
    settingsDraft?: Settings;
    authProviders?: AuthProviderMetadata[];
    settingsMessage?: string;
    themePreference?: ThemePreference;
    onBack?: () => void;
    onLoadSettings?: () => void;
    onSaveSettings?: () => void;
    onThemeChange?: (theme: ThemePreference) => void;
  };

  let {
    status,
    settingsDraft = $bindable<Settings | undefined>(),
    authProviders = [],
    settingsMessage,
    themePreference = "system",
    onBack,
    onLoadSettings,
    onSaveSettings,
    onThemeChange,
  }: Props = $props();

  let activeSection = $state<SettingsSection>("general");

  const themeItems: RadioItem[] = [
    { value: "system", label: "System", detail: "Follow the operating system" },
    { value: "dark", label: "Dark", detail: "Technical Precision reference" },
    { value: "light", label: "Light", detail: "Fallback desktop surfaces" },
  ];

  const modeItems: RadioItem[] = [
    { value: "coding", label: "Coding", detail: "Implement, edit files, and run checks" },
    { value: "planning", label: "Planning", detail: "Inspect, reason, and prepare before edits" },
  ];

  const permissionItems: RadioItem[] = [
    { value: "read_only", label: "Read only", detail: "No writes or mutating commands" },
    { value: "supervised", label: "Supervised", detail: "Ask before sensitive actions" },
    { value: "autonomous", label: "Autonomous", detail: "Proceed with broader authority" },
  ];

  const navItems: { value: SettingsSection; label: string; detail: string }[] = [
    { value: "general", label: "General", detail: "Daemon and storage" },
    { value: "appearance", label: "Appearance", detail: "Theme surfaces" },
    { value: "providers", label: "Providers", detail: "Credential status" },
    { value: "agents", label: "Agents", detail: "Defaults and policy" },
    { value: "network", label: "Network", detail: "Server binding" },
  ];

  const configuredProviders = $derived(authProviders.filter((provider) => provider.configured).length);

  function setThemePreference(value: string) {
    const preference = value as ThemePreference;
    if (settingsDraft) settingsDraft.ui.theme = preference;
    onThemeChange?.(preference);
  }

  function updateNumber(path: "thresholdTokens" | "keepRecentTokens", value: string) {
    if (!settingsDraft) return;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) settingsDraft.compaction[path] = Math.floor(parsed);
  }

  function updateServerPort(value: string) {
    if (!settingsDraft) return;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) settingsDraft.server.port = Math.floor(parsed);
  }

  function providerCommand(provider: AuthProviderMetadata): string {
    if (provider.supportsOAuth) return `nerve auth login ${provider.provider}`;
    if (provider.supportsApiKey) return `nerve auth set ${provider.provider}`;
    return "nerve auth list";
  }

  function providerBadge(provider: AuthProviderMetadata): string {
    if (!provider.configured) return "inactive";
    if (provider.credentialType === "oauth") return "oauth";
    if (provider.credentialType === "api_key") return "api key";
    return "active";
  }

  function writePolicy(permission: Settings["defaultPermissionLevel"] | undefined): string {
    if (permission === "read_only") return "Denied";
    if (permission === "supervised") return "Approval required";
    if (permission === "autonomous") return "Allowed in scope";
    return "Policy-managed";
  }

  function commandPolicy(permission: Settings["defaultPermissionLevel"] | undefined): string {
    if (permission === "read_only") return "Denied";
    if (permission === "supervised") return "Approval required";
    if (permission === "autonomous") return "Allowed; destructive still gated";
    return "Policy-managed";
  }
</script>

<section class="settings-page">
  <header class="settings-header">
    <div class="heading-block">
      <span class="breadcrumb">nerve <b>/</b> settings <b>/</b> <em>{activeSection}</em></span>
      <h1>Workbench Settings</h1>
      <p>Control app appearance, agent defaults, compaction, server binding, and provider access.</p>
    </div>
    <div class="header-actions">
      <Button variant="secondary" size="sm" onclick={onBack}><ArrowLeft size={13} strokeWidth={2.25} />Workspace</Button>
      <Button variant="toolbar" size="sm" onclick={onLoadSettings}><RefreshCw size={13} strokeWidth={2.25} />Refresh</Button>
      <Button size="sm" onclick={onSaveSettings} disabled={!settingsDraft}><Save size={13} strokeWidth={2.25} />Save settings</Button>
    </div>
  </header>

  <div class="settings-grid">
    <aside class="settings-rail" aria-label="Settings sections">
      <div class="rail-title">
        <Settings2 size={14} strokeWidth={2.2} />
        <span>Configuration</span>
      </div>
      {#each navItems as item}
        <button class:active={activeSection === item.value} type="button" onclick={() => (activeSection = item.value)}>
          <strong>{item.label}</strong>
          <small>{item.detail}</small>
        </button>
      {/each}
      <div class="rail-status">
        <section>
          <span>Theme</span>
          <strong>{themePreference}</strong>
        </section>
        <section>
          <span>Providers</span>
          <strong>{configuredProviders}/{authProviders.length} configured</strong>
        </section>
      </div>
    </aside>

    <ScrollArea class="settings-scroll" viewportClass="settings-viewport" type="auto">
      {#if !settingsDraft}
        <section class="settings-card empty-card">
          <Sparkles size={28} strokeWidth={1.8} />
          <strong>Settings are loading</strong>
          <p>Refresh if this takes longer than expected.</p>
        </section>
      {:else}
        <div class="settings-main">
          {#if activeSection === "general"}
          <section class="settings-card" data-section="general">
            <div class="card-head">
              <div class="card-icon"><Settings2 size={16} strokeWidth={2.2} /></div>
              <div>
                <span class="eyebrow">General</span>
                <h2>Daemon state</h2>
                <p>Read-only runtime metadata from the orchestrator.</p>
              </div>
            </div>
            <div class="stat-grid">
              <section><span>Daemon</span><strong>{status?.daemonId ?? "not loaded"}</strong></section>
              <section><span>Version</span><strong>{status?.version ?? "—"}</strong></section>
              <section><span>Started</span><strong>{status?.startedAt ? new Date(status.startedAt).toLocaleString() : "—"}</strong></section>
              <section><span>Index</span><strong>{status?.storage.indexHealthy ? "healthy" : "unknown"}</strong></section>
              <section class="wide"><span>Data directory</span><strong title={status?.dataDir}>{status?.dataDir ?? "—"}</strong></section>
              <section class="wide"><span>SQLite</span><strong title={status?.storage.sqlitePath}>{status?.storage.sqlitePath ?? "—"}</strong></section>
            </div>
          </section>
          {/if}

          {#if activeSection === "appearance"}
          <section class="settings-card" data-section="appearance">
            <div class="card-head">
              <div class="card-icon"><Monitor size={16} strokeWidth={2.2} /></div>
              <div>
                <span class="eyebrow">Appearance</span>
                <h2>Theme</h2>
                <p>Dark mode follows the Stitch Technical Precision reference. Light remains as a compatibility fallback.</p>
              </div>
            </div>
            <RadioGroup
              items={themeItems}
              value={settingsDraft.ui.theme}
              orientation="horizontal"
              ariaLabel="Theme preference"
              onValueChange={setThemePreference}
            />
          </section>
          {/if}

          {#if activeSection === "providers"}
          <section class="settings-card" data-section="providers">
            <div class="card-head">
              <div class="card-icon"><KeyRound size={16} strokeWidth={2.2} /></div>
              <div>
                <span class="eyebrow">Providers</span>
                <h2>Credential status</h2>
                <p>Credentials are managed from the CLI only. Raw secrets are never rendered in the browser.</p>
              </div>
            </div>
            {#if authProviders.length === 0}
              <p class="muted">No provider metadata available. Use <code>nerve auth list</code> in the CLI.</p>
            {:else}
              <div class="provider-list">
                {#each authProviders as provider}
                  <article class="provider-row">
                    <div>
                      <strong>{provider.displayName}</strong>
                      <small>{provider.provider}{provider.envVar ? ` · ${provider.envVar}` : ""}</small>
                    </div>
                    <Badge size="xs" tone={provider.configured ? "good" : "neutral"}>{providerBadge(provider)}</Badge>
                    {#if provider.warning}<p>{provider.warning}</p>{/if}
                    <code>{provider.configured ? "nerve auth list" : providerCommand(provider)}</code>
                  </article>
                {/each}
              </div>
            {/if}
          </section>
          {/if}

          {#if activeSection === "agents"}
          <section class="settings-card" data-section="agents">
            <div class="card-head">
              <div class="card-icon"><Bot size={16} strokeWidth={2.2} /></div>
              <div>
                <span class="eyebrow">Agents</span>
                <h2>Default behavior and policy</h2>
                <p>Defaults apply to newly created root agents and subagents.</p>
              </div>
            </div>
            <div class="defaults-grid">
              <div class="control-block">
                <h3>Root mode</h3>
                <RadioGroup items={modeItems} value={settingsDraft.defaultMode} ariaLabel="Default root mode" onValueChange={(value) => { if (settingsDraft) settingsDraft.defaultMode = value as Settings["defaultMode"]; }} />
              </div>
              <div class="control-block">
                <h3>Root permission</h3>
                <RadioGroup items={permissionItems} value={settingsDraft.defaultPermissionLevel} ariaLabel="Default root permission" onValueChange={(value) => { if (settingsDraft) settingsDraft.defaultPermissionLevel = value as Settings["defaultPermissionLevel"]; }} />
              </div>
              <div class="control-block">
                <h3>Subagent mode</h3>
                <RadioGroup items={modeItems} value={settingsDraft.defaultSubagentMode} ariaLabel="Default subagent mode" onValueChange={(value) => { if (settingsDraft) settingsDraft.defaultSubagentMode = value as Settings["defaultSubagentMode"]; }} />
              </div>
              <div class="control-block">
                <h3>Subagent permission</h3>
                <RadioGroup items={permissionItems} value={settingsDraft.defaultSubagentPermissionLevel} ariaLabel="Default subagent permission" onValueChange={(value) => { if (settingsDraft) settingsDraft.defaultSubagentPermissionLevel = value as Settings["defaultSubagentPermissionLevel"]; }} />
              </div>
            </div>

            <div class="permission-table" role="table" aria-label="Default agent permissions">
              <div role="row"><span role="columnheader">Capability</span><span role="columnheader">Default policy</span></div>
              <div role="row"><span>File system read</span><strong>Allowed within workspace scope</strong></div>
              <div role="row"><span>File system write</span><strong>{writePolicy(settingsDraft.defaultPermissionLevel)}</strong></div>
              <div role="row"><span>Terminal command execution</span><strong>{commandPolicy(settingsDraft.defaultPermissionLevel)}</strong></div>
              <div role="row"><span>Network access</span><strong>Policy-managed by tools and daemon</strong></div>
            </div>
          </section>
          {/if}

          {#if activeSection === "network"}
          <section class="settings-card" data-section="network">
            <div class="card-head">
              <div class="card-icon"><Server size={16} strokeWidth={2.2} /></div>
              <div>
                <span class="eyebrow">Network</span>
                <h2>Server binding and compaction</h2>
                <p>Host and port changes apply after daemon restart. Keep local binding unless remote access is required.</p>
              </div>
            </div>
            <div class="server-grid">
              <label>Host<Input value={settingsDraft.server.host} size="sm" ariaLabel="Server host" oninput={(event) => { if (settingsDraft) settingsDraft.server.host = (event.currentTarget as HTMLInputElement).value; }} /></label>
              <label>Port<Input value={String(settingsDraft.server.port)} type="number" size="sm" ariaLabel="Server port" oninput={(event) => updateServerPort((event.currentTarget as HTMLInputElement).value)} /></label>
            </div>
            <div class="switch-card">
              <Switch bind:checked={settingsDraft.server.allowRemote} label="Allow remote connections" description="Restart the daemon after changing host, port, or remote access." />
            </div>
            <div class="compaction-card">
              <div>
                <Shield size={14} strokeWidth={2.2} />
                <strong>Transcript compaction</strong>
              </div>
              <Switch bind:checked={settingsDraft.compaction.auto} label="Auto-compact sessions" description="Let the daemon compact long branches when thresholds are reached." />
              <div class="server-grid">
                <label>Threshold tokens<Input value={String(settingsDraft.compaction.thresholdTokens)} type="number" size="sm" ariaLabel="Compaction threshold tokens" oninput={(event) => updateNumber("thresholdTokens", (event.currentTarget as HTMLInputElement).value)} /></label>
                <label>Keep recent<Input value={String(settingsDraft.compaction.keepRecentTokens)} type="number" size="sm" ariaLabel="Keep recent tokens" oninput={(event) => updateNumber("keepRecentTokens", (event.currentTarget as HTMLInputElement).value)} /></label>
              </div>
            </div>
          </section>
          {/if}

          {#if settingsMessage}<p class="settings-message">{settingsMessage}</p>{/if}
        </div>
      {/if}
    </ScrollArea>
  </div>
</section>

<style>
  .settings-page {
    display: grid;
    height: 100%;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--color-bg);
  }

  .settings-header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-panel-muted);
    padding: 0.85rem 1rem;
  }

  .heading-block {
    display: grid;
    min-width: 0;
    gap: 0.22rem;
  }

  .breadcrumb,
  .eyebrow,
  .rail-title,
  h3 {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  .breadcrumb b {
    color: var(--color-faint);
    font-weight: var(--weight-normal);
  }

  .breadcrumb em {
    color: var(--color-accent);
    font-style: normal;
  }

  h1,
  h2,
  h3,
  p {
    margin: 0;
  }

  h1 {
    color: var(--color-text);
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
  }

  .heading-block p,
  .card-head p,
  .muted {
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  .header-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: end;
    gap: 0.42rem;
  }

  .settings-grid {
    display: grid;
    grid-template-columns: 15rem minmax(0, 1fr);
    min-height: 0;
  }

  .settings-rail {
    display: grid;
    align-content: start;
    gap: 0.25rem;
    border-right: 1px solid var(--color-border);
    background: var(--color-pane);
    padding: 0.65rem;
  }

  .rail-title {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.2rem 0.5rem;
  }

  .settings-rail button {
    position: relative;
    display: grid;
    width: 100%;
    gap: 0.12rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-muted);
    padding: 0.48rem 0.55rem;
    text-align: left;
    cursor: pointer;
  }

  .settings-rail button:hover,
  .settings-rail button.active {
    border-color: var(--color-border-subtle);
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  .settings-rail button.active::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 2px;
    background: var(--color-accent);
  }

  .settings-rail button strong {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  .settings-rail button small {
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .rail-status {
    display: grid;
    gap: 0.35rem;
    margin-top: 0.6rem;
  }

  .rail-status section {
    display: grid;
    gap: 0.1rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    padding: 0.45rem;
  }

  .rail-status span,
  .stat-grid span {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  .rail-status strong,
  .stat-grid strong {
    overflow: hidden;
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.settings-scroll) {
    min-height: 0;
  }

  :global(.settings-viewport) {
    padding: 0.8rem;
  }

  .settings-main {
    display: grid;
    gap: 1.25rem;
    width: 100%;
    max-width: 52rem;
    margin: 0 auto;
    min-width: 0;
  }

  .settings-card,
  .empty-card {
    display: grid;
    gap: 0.75rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    padding: 0.85rem;
    box-shadow: var(--shadow-panel);
  }

  .empty-card {
    justify-items: center;
    padding: 3rem 1rem;
    color: var(--color-muted);
    text-align: center;
  }

  .empty-card :global(svg) {
    color: var(--color-accent);
  }

  .empty-card strong {
    color: var(--color-text);
    font-size: var(--text-lg);
  }

  .card-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 0.62rem;
  }

  .card-icon {
    display: inline-grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-accent);
  }

  .eyebrow {
    color: var(--color-accent);
  }

  h2 {
    color: var(--color-text);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
  }

  h3 {
    color: var(--color-muted);
    font-weight: var(--weight-semibold);
  }

  .stat-grid,
  .defaults-grid,
  .server-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.55rem;
  }

  .stat-grid section,
  .switch-card,
  .compaction-card,
  .control-block,
  .permission-table {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    padding: 0.55rem;
  }

  .stat-grid section {
    display: grid;
    gap: 0.14rem;
  }

  .stat-grid .wide {
    grid-column: 1 / -1;
  }

  .control-block,
  .compaction-card {
    display: grid;
    align-content: start;
    gap: 0.5rem;
  }

  .compaction-card > div:first-child {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--color-text);
  }

  label {
    display: grid;
    gap: 0.24rem;
    color: var(--color-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }

  .provider-list {
    display: grid;
    gap: 0.45rem;
  }

  .provider-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.45rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    padding: 0.55rem;
  }

  .provider-row div {
    display: grid;
    min-width: 0;
    gap: 0.1rem;
  }

  .provider-row strong {
    color: var(--color-text);
    font-size: var(--text-sm);
  }

  .provider-row small,
  .provider-row p {
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .provider-row p,
  .provider-row code {
    grid-column: 1 / -1;
  }

  code {
    overflow: auto;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-xs);
    background: var(--color-code-bg);
    color: var(--color-code);
    padding: 0.34rem 0.42rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .permission-table {
    display: grid;
    padding: 0;
    overflow: hidden;
  }

  .permission-table div {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .permission-table div:last-child {
    border-bottom: 0;
  }

  .permission-table span,
  .permission-table strong {
    padding: 0.48rem 0.55rem;
    font-size: var(--text-xs);
  }

  .permission-table div:first-child span {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  .permission-table strong {
    color: var(--color-text);
    font-weight: var(--weight-medium);
  }

  .settings-message {
    border: 1px solid var(--color-accent-muted);
    border-radius: var(--radius-sm);
    background: var(--color-accent-soft);
    color: var(--color-accent);
    padding: 0.55rem 0.65rem;
    font-size: var(--text-sm);
  }

  @media (max-width: 960px) {
    .settings-header,
    .settings-grid,
    .defaults-grid,
    .server-grid,
    .stat-grid,
    .permission-table div {
      grid-template-columns: minmax(0, 1fr);
    }

    .settings-header {
      display: grid;
      align-items: start;
    }

    .settings-rail {
      border-right: 0;
      border-bottom: 1px solid var(--color-border-subtle);
    }
  }
</style>

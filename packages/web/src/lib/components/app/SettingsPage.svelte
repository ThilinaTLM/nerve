<script lang="ts">
  import ArrowLeft from "lucide-svelte/icons/arrow-left";
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import KeyRound from "lucide-svelte/icons/key-round";
  import Monitor from "lucide-svelte/icons/monitor";
  import RefreshCw from "lucide-svelte/icons/refresh-cw";
  import Save from "lucide-svelte/icons/save";
  import Server from "lucide-svelte/icons/server";
  import Settings2 from "lucide-svelte/icons/settings-2";
  import Shield from "lucide-svelte/icons/shield";
  import SlidersHorizontal from "lucide-svelte/icons/sliders-horizontal";
  import Sparkles from "lucide-svelte/icons/sparkles";
  import { Accordion as AccordionPrimitive } from "bits-ui";
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

  let accordionValue = $state<string[]>(["server", "providers"]);

  const themeItems: RadioItem[] = [
    { value: "system", label: "System", detail: "Follow the operating system" },
    { value: "light", label: "Light", detail: "Bright desktop surfaces" },
    { value: "dark", label: "Dark", detail: "Dim command-center surfaces" },
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
</script>

<section class="settings-page">
  <header class="settings-header">
    <div class="heading-block">
      <span class="eyebrow"><Settings2 size={14} strokeWidth={2.2} />Global configuration</span>
      <h1>Settings</h1>
      <p>Control app appearance, agent defaults, compaction, server binding, and provider access.</p>
    </div>
    <div class="header-actions">
      <Button variant="secondary" size="sm" onclick={onBack}><ArrowLeft size={13} strokeWidth={2.25} />Workspace</Button>
      <Button variant="toolbar" size="sm" onclick={onLoadSettings}><RefreshCw size={13} strokeWidth={2.25} />Refresh</Button>
      <Button size="sm" onclick={onSaveSettings} disabled={!settingsDraft}><Save size={13} strokeWidth={2.25} />Save settings</Button>
    </div>
  </header>

  <ScrollArea class="settings-scroll" viewportClass="settings-viewport" type="auto">
    <div class="settings-grid">
      <aside class="settings-rail">
        <section>
          <span>Theme</span>
          <strong>{themePreference}</strong>
        </section>
        <section>
          <span>Daemon</span>
          <strong>{status?.daemonId ?? "not loaded"}</strong>
        </section>
        <section>
          <span>Data directory</span>
          <strong title={status?.dataDir}>{status?.dataDir ?? "—"}</strong>
        </section>
        <section>
          <span>Providers</span>
          <strong>{authProviders.filter((provider) => provider.configured).length}/{authProviders.length} configured</strong>
        </section>
      </aside>

      <div class="settings-main">
        {#if !settingsDraft}
          <section class="settings-card empty-card">
            <Sparkles size={28} strokeWidth={1.8} />
            <strong>Settings are loading</strong>
            <p>Refresh if this takes longer than expected.</p>
          </section>
        {:else}
          <section class="settings-card">
            <div class="card-head">
              <div class="card-icon"><Monitor size={16} strokeWidth={2.2} /></div>
              <div>
                <h2>Appearance</h2>
                <p>Choose how the desktop shell should render surfaces and text.</p>
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

          <section class="settings-card">
            <div class="card-head">
              <div class="card-icon"><SlidersHorizontal size={16} strokeWidth={2.2} /></div>
              <div>
                <h2>Agent defaults</h2>
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
          </section>

          <section class="settings-card">
            <div class="card-head">
              <div class="card-icon"><Shield size={16} strokeWidth={2.2} /></div>
              <div>
                <h2>Compaction</h2>
                <p>Control automatic transcript compaction for long-running conversations.</p>
              </div>
            </div>
            <div class="compaction-row">
              <Switch bind:checked={settingsDraft.compaction.auto} label="Auto-compact sessions" description="Let the daemon compact long branches when thresholds are reached." />
            </div>
            <div class="number-grid">
              <label>Threshold tokens<Input value={String(settingsDraft.compaction.thresholdTokens)} type="number" size="sm" ariaLabel="Compaction threshold tokens" oninput={(event) => updateNumber("thresholdTokens", (event.currentTarget as HTMLInputElement).value)} /></label>
              <label>Keep recent<Input value={String(settingsDraft.compaction.keepRecentTokens)} type="number" size="sm" ariaLabel="Keep recent tokens" oninput={(event) => updateNumber("keepRecentTokens", (event.currentTarget as HTMLInputElement).value)} /></label>
            </div>
          </section>

          <AccordionPrimitive.Root class="settings-accordion" type="multiple" bind:value={accordionValue}>
            <AccordionPrimitive.Item class="accordion-item" value="server">
              <AccordionPrimitive.Header>
                <AccordionPrimitive.Trigger class="accordion-trigger">
                  <span><Server size={16} strokeWidth={2.2} />Server</span>
                  <ChevronDown size={15} strokeWidth={2.3} />
                </AccordionPrimitive.Trigger>
              </AccordionPrimitive.Header>
              <AccordionPrimitive.Content class="accordion-content">
                <div class="settings-card nested-card">
                  <p class="section-copy">These values affect daemon binding after restart. Use local binding unless you explicitly need remote access.</p>
                  <div class="server-grid">
                    <label>Host<Input value={settingsDraft.server.host} size="sm" ariaLabel="Server host" oninput={(event) => { if (settingsDraft) settingsDraft.server.host = (event.currentTarget as HTMLInputElement).value; }} /></label>
                    <label>Port<Input value={String(settingsDraft.server.port)} type="number" size="sm" ariaLabel="Server port" oninput={(event) => updateServerPort((event.currentTarget as HTMLInputElement).value)} /></label>
                  </div>
                  <Switch bind:checked={settingsDraft.server.allowRemote} label="Allow remote connections" description="Restart the daemon after changing host, port, or remote access." />
                </div>
              </AccordionPrimitive.Content>
            </AccordionPrimitive.Item>

            <AccordionPrimitive.Item class="accordion-item" value="providers">
              <AccordionPrimitive.Header>
                <AccordionPrimitive.Trigger class="accordion-trigger">
                  <span><KeyRound size={16} strokeWidth={2.2} />Provider access</span>
                  <ChevronDown size={15} strokeWidth={2.3} />
                </AccordionPrimitive.Trigger>
              </AccordionPrimitive.Header>
              <AccordionPrimitive.Content class="accordion-content">
                <div class="settings-card nested-card">
                  <p class="section-copy">Credentials are managed from the CLI only. Raw secrets are never rendered in the browser.</p>
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
                          <Badge size="xs" tone={provider.configured ? "good" : "neutral"}>{provider.configured ? provider.credentialType ?? "configured" : "not configured"}</Badge>
                          {#if provider.warning}<p>{provider.warning}</p>{/if}
                          <code>{provider.configured ? "nerve auth list" : providerCommand(provider)}</code>
                        </article>
                      {/each}
                    </div>
                  {/if}
                </div>
              </AccordionPrimitive.Content>
            </AccordionPrimitive.Item>
          </AccordionPrimitive.Root>

          {#if settingsMessage}<p class="settings-message">{settingsMessage}</p>{/if}
        {/if}
      </div>
    </div>
  </ScrollArea>
</section>

<style>
  .settings-page {
    display: grid;
    height: 100%;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    background:
      radial-gradient(circle at top left, rgb(155 214 111 / 8%), transparent 25rem),
      var(--color-bg-deep);
  }

  .settings-header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel-muted) 88%, transparent);
    padding: 1.1rem 1.25rem 1rem;
  }

  .heading-block {
    display: grid;
    min-width: 0;
    gap: 0.22rem;
  }

  .eyebrow {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--color-accent);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  h1,
  h2,
  h3,
  p {
    margin: 0;
  }

  h1 {
    color: var(--color-text);
    font-family: var(--font-display);
    font-size: clamp(1.45rem, 2vw, 2rem);
    font-weight: var(--weight-bold);
    line-height: var(--leading-tight);
  }

  .heading-block p,
  .card-head p,
  .section-copy,
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

  :global(.settings-scroll) {
    min-height: 0;
  }

  :global(.settings-viewport) {
    padding: 1rem;
  }

  .settings-grid {
    display: grid;
    grid-template-columns: minmax(12rem, 17rem) minmax(0, 1fr);
    gap: 1rem;
    max-width: 1180px;
    margin: 0 auto;
  }

  .settings-rail {
    position: sticky;
    top: 0;
    display: grid;
    align-self: start;
    gap: 0.45rem;
  }

  .settings-rail section,
  .settings-card {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
    box-shadow: var(--shadow-panel);
  }

  .settings-rail section {
    display: grid;
    gap: 0.12rem;
    padding: 0.65rem;
  }

  .settings-rail span {
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .settings-rail strong {
    overflow: hidden;
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .settings-main {
    display: grid;
    gap: 0.8rem;
    min-width: 0;
  }

  .settings-card {
    display: grid;
    gap: 0.72rem;
    padding: 0.85rem;
  }

  .nested-card {
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
    border-top: 0;
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
    border-radius: var(--radius-md);
    background: var(--color-field);
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
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  .defaults-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .control-block {
    display: grid;
    align-content: start;
    gap: 0.42rem;
  }

  .compaction-row {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-field);
    padding: 0.6rem;
  }

  .number-grid,
  .server-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.55rem;
  }

  label {
    display: grid;
    gap: 0.24rem;
    color: var(--color-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }

  :global(.settings-accordion) {
    display: grid;
    gap: 0.55rem;
  }

  :global(.accordion-item) {
    overflow: hidden;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
  }

  :global(.accordion-trigger) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    border: 0;
    background: var(--color-panel-muted);
    color: var(--color-text);
    padding: 0.7rem 0.85rem;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
  }

  :global(.accordion-trigger span) {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }

  :global(.accordion-trigger > svg) {
    color: var(--color-muted);
    transition: transform 160ms ease;
  }

  :global(.accordion-trigger[data-state="open"] > svg) {
    transform: rotate(180deg);
  }

  :global(.accordion-trigger:focus-visible) {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
  }

  :global(.accordion-content) {
    overflow: hidden;
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
    border-radius: var(--radius-md);
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
    border-radius: var(--radius-sm);
    background: var(--color-code-bg);
    color: var(--color-code);
    padding: 0.34rem 0.42rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .settings-message {
    border: 1px solid var(--color-accent-soft);
    border-radius: var(--radius-md);
    background: var(--color-accent-soft);
    color: var(--color-accent);
    padding: 0.55rem 0.65rem;
    font-size: var(--text-sm);
  }

  @media (max-width: 900px) {
    .settings-header,
    .settings-grid,
    .defaults-grid,
    .number-grid,
    .server-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .settings-header {
      display: grid;
      align-items: start;
    }

    .settings-rail {
      position: static;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 560px) {
    .settings-rail {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>

<script lang="ts">
  import {
    CheckCircle2,
    ExternalLink,
    KeyRound,
    LoaderCircle,
    Plus,
    RefreshCw,
    TriangleAlert,
  } from "@lucide/svelte";
  import { SettingsSectionCard, SettingsShell, type SettingsShellGroup } from "@nervekit/workbench-ui/components/settings";
  import { Badge } from "@nervekit/workbench-ui/components/ui/badge";
  import { Button } from "@nervekit/workbench-ui/components/ui/button";
  import DialogShell from "@nervekit/workbench-ui/components/ui/dialog-shell";
  import { Input } from "@nervekit/workbench-ui/components/ui/input";
  import { Label } from "@nervekit/workbench-ui/components/ui/label";
  import SelectField from "@nervekit/workbench-ui/components/ui/select-field";
  import { Textarea } from "@nervekit/workbench-ui/components/ui/textarea";
  import type {
    ModelInfo,
    SandboxManagerCredentialProfile,
    SandboxManagerCredentialProviderKind,
  } from "@nervekit/contracts";
  import { SandboxManagerOAuthFlow } from "../credentials/sandbox-manager-oauth-flow.svelte";
  import AppearanceSettings from "./AppearanceSettings.svelte";
  import { buildCredentialProfileWrite } from "../../settings/profile-form";
  import {
    domains,
    domainForSectionId,
    resolveDomainId,
    sections,
    sectionsForDomain,
    type ProviderOption,
    type SettingsDomain,
    type SettingsDomainId,
    type SettingsSection,
    type SettingsSectionId,
  } from "../../settings/provider-catalog";
  import { untrack } from "svelte";
  import { useSandboxCenter } from "../../state/sandbox-center.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import { modelDisplayName } from "../../utils/model-display";

  const store = useSandboxManagerStore();
  const center = useSandboxCenter();
  let activeDomainId = $state<SettingsDomainId>(
    untrack(() => resolveDomainId(center.settingsSection)),
  );

  // Follow the shared center settings-section selection.
  $effect(() => {
    activeDomainId = resolveDomainId(center.settingsSection);
  });
  let activeSectionId = $state<SettingsSectionId>("llm_subscriptions");
  let providerSearch = $state("");
  const appearanceActive = $derived(activeDomainId === "appearance");
  const activeDomain = $derived(
    domains.find((domain) => domain.id === activeDomainId) ?? domains[0],
  );
  const domainSections = $derived(sectionsForDomain(activeDomain));
  const shellGroups = $derived<SettingsShellGroup[]>(
    domains.map((domain) => ({
      id: domain.id,
      label: domain.label,
      description: domain.description,
      icon: domain.icon,
      sections: sectionsForDomain(domain).map((section) => ({
        id: section.id,
        label: section.tabLabel ?? section.label,
      })),
    })),
  );

  // Keep the active sub-section valid for the current domain.
  $effect(() => {
    if (
      domainSections.length > 0 &&
      !domainSections.some((section) => section.id === activeSectionId)
    )
      activeSectionId = domainSections[0].id;
  });
  let providerKind = $state<SandboxManagerCredentialProviderKind>(
    "anthropic_oauth",
  );
  let displayName = $state("");
  let secretValue = $state("");
  let siteUrl = $state("");
  let email = $state("");
  let defaultModel = $state("");
  let api = $state("");
  let baseUrl = $state("");
  let envJson = $state("");
  let headersJson = $state("");
  let compatJson = $state("");
  let providerOptionsJson = $state("");
  let defaultOwner = $state("");
  let defaultRepo = $state("");
  let defaultProjectKey = $state("");
  let defaultSpaceKey = $state("");
  let githubAppId = $state("");
  let githubInstallationId = $state("");
  let busy = $state(false);
  let refreshingProfileId = $state<string | undefined>(undefined);
  let addDialogOpen = $state(false);
  let advancedOpen = $state(false);
  let manualOAuthImport = $state(false);
  let error = $state<string | undefined>(undefined);
  let saved = $state<string | undefined>(undefined);

  const activeSection = $derived(
    sections.find((section) => section.id === activeSectionId) ?? sections[0],
  );
  const selectedOption = $derived(
    activeSection.options.find((option) => option.providerKind === providerKind),
  );
  const providerItems = $derived(
    activeSection.options
      .filter((option) =>
        providerSearch.trim()
          ? `${option.label} ${option.provider}`
              .toLowerCase()
              .includes(providerSearch.trim().toLowerCase())
          : true,
      )
      .map((option) => ({
        value: option.providerKind,
        label: option.label,
      })),
  );
  const selectedProviderModels = $derived.by<ModelInfo[]>(() =>
    selectedOption?.kind === "model_provider"
      ? store.models
          .filter((model) => model.provider === selectedOption.provider)
          .sort((left, right) =>
            modelDisplayName(left).localeCompare(modelDisplayName(right)),
          )
      : [],
  );
  const modelItems = $derived.by(() => {
    const items = selectedProviderModels.map((model) => ({
      value: model.modelId,
      label: modelDisplayName(model),
      detail: model.modelId,
    }));
    if (
      defaultModel.trim() &&
      selectedProviderModels.length > 0 &&
      !items.some((item) => item.value === defaultModel)
    ) {
      return [
        {
          value: defaultModel,
          label: `${defaultModel} (current)`,
          detail: "Current template value",
        },
        ...items,
      ];
    }
    return items;
  });
  const configuredCount = $derived(store.credentialProfiles.length);
  const oauthFlow = new SandboxManagerOAuthFlow({
    onSucceeded: async (flow) => {
      await store.refreshCredentials();
      saved = flow.message ?? `Connected ${flow.providerName}.`;
      error = undefined;
      manualOAuthImport = false;
      advancedOpen = false;
      addDialogOpen = false;
      applyOptionDefaults(selectedOption, false);
    },
  });

  $effect(() => {
    if (activeSection.options.length === 0) return;
    if (
      !activeSection.options.some((option) => option.providerKind === providerKind)
    ) {
      providerKind = activeSection.options[0].providerKind;
      applyOptionDefaults(activeSection.options[0], false);
    }
  });

  function profilesForSection(
    section: SettingsSection,
  ): SandboxManagerCredentialProfile[] {
    const kinds = new Set(section.options.map((option) => option.providerKind));
    return store.credentialProfiles.filter((profile) => kinds.has(profile.providerKind));
  }

  function prettyJson(value: Record<string, unknown> | undefined): string {
    return value ? JSON.stringify(value, null, 2) : "";
  }

  function applyOptionDefaults(
    option: ProviderOption | undefined = selectedOption,
    clearMessages = true,
  ): void {
    displayName = "";
    secretValue = "";
    siteUrl = "";
    email = "";
    defaultModel = option?.defaultModel ?? "";
    api = option?.api ?? "";
    baseUrl = option?.baseUrl ?? "";
    envJson = prettyJson(option?.envTemplate);
    headersJson = prettyJson(option?.headersTemplate);
    compatJson = prettyJson(option?.compatTemplate);
    providerOptionsJson = prettyJson(option?.providerOptionsTemplate);
    defaultOwner = "";
    defaultRepo = "";
    defaultProjectKey = "";
    defaultSpaceKey = "";
    githubAppId = "";
    githubInstallationId = "";
    advancedOpen = false;
    if (clearMessages) {
      error = undefined;
      saved = undefined;
    }
  }

  function countForDomain(domain: SettingsDomain): number | undefined {
    if (domain.custom === "appearance") return undefined;
    return sectionsForDomain(domain).reduce(
      (total, section) => total + profilesForSection(section).length,
      0,
    );
  }

  function selectDomain(domainId: SettingsDomainId): void {
    activeDomainId = domainId;
    providerSearch = "";
    center.settingsSection = domainId.replace(/_/g, "-");
    const domain = domains.find((item) => item.id === domainId);
    const first = domain ? sectionsForDomain(domain)[0] : undefined;
    if (first) {
      activeSectionId = first.id;
      if (first.options[0]) providerKind = first.options[0].providerKind;
      applyOptionDefaults(first.options[0]);
    }
  }

  function selectShellGroup(groupId: string): void {
    selectDomain(groupId as SettingsDomainId);
  }

  function selectShellSection(sectionId: string): void {
    activeSectionId = sectionId as SettingsSectionId;
  }

  function selectProvider(value: string): void {
    providerKind = value as SandboxManagerCredentialProviderKind;
    const option = activeSection.options.find(
      (item) => item.providerKind === providerKind,
    );
    manualOAuthImport = false;
    if (oauthFlow.active) void oauthFlow.close();
    else oauthFlow.reset();
    applyOptionDefaults(option);
  }

  function openAddDialog(sectionId: SettingsSectionId = activeSectionId): void {
    const section = sections.find((item) => item.id === sectionId);
    if (!section?.options[0]) return;
    activeDomainId = domainForSectionId(section.id);
    activeSectionId = section.id;
    providerSearch = "";
    providerKind = section.options[0].providerKind;
    manualOAuthImport = false;
    if (oauthFlow.active) void oauthFlow.close();
    else oauthFlow.reset();
    applyOptionDefaults(section.options[0]);
    addDialogOpen = true;
  }

  function supportsBrowserOAuth(option: ProviderOption | undefined): boolean {
    return Boolean(
      option &&
        option.kind === "model_provider" &&
        option.secretMode === "oauth" &&
        [
          "anthropic_oauth",
          "openai_codex_oauth",
          "github_copilot_oauth",
        ].includes(option.providerKind),
    );
  }

  function useBrowserOAuth(option: ProviderOption | undefined): boolean {
    return supportsBrowserOAuth(option) && !manualOAuthImport;
  }

  function selectorLabel(option: ProviderOption): string {
    if (option.kind === "model_provider") return "Provider";
    if (
      option.providerKind.includes("ssh") ||
      option.providerKind.includes("token") ||
      option.providerKind.includes("github")
    )
      return "Authentication method";
    return "Profile type";
  }

  function searchLabel(option: ProviderOption): string {
    return option.kind === "model_provider"
      ? "Search providers"
      : "Search profile types";
  }

  function dialogDescription(): string {
    if (!selectedOption) return "Add a credential profile.";
    if (activeSection.options.length === 1) return selectedOption.detail;
    if (selectedOption.kind === "model_provider")
      return "Choose a provider and add the credential.";
    return `Choose a ${selectorLabel(selectedOption).toLowerCase()} and add the credential.`;
  }

  function hasAdvancedOptions(option: ProviderOption): boolean {
    return option.providerKind !== "git_identity";
  }

  function canSaveProfile(option: ProviderOption): boolean {
    if (busy) return false;
    if (option.providerKind === "git_identity")
      return displayName.trim().length > 0 && email.trim().length > 0;
    if (option.secretMode === "githubApp")
      return (
        secretValue.trim().length > 0 &&
        githubAppId.trim().length > 0 &&
        githubInstallationId.trim().length > 0
      );
    return option.secretMode === "none" || secretValue.trim().length > 0;
  }

  async function closeAddDialog(): Promise<void> {
    await oauthFlow.close();
    manualOAuthImport = false;
    advancedOpen = false;
    addDialogOpen = false;
  }

  function handleAddDialogOpenChange(next: boolean): void {
    if (!next) void closeAddDialog();
  }

  async function startBrowserOAuth(): Promise<void> {
    if (!selectedOption || !supportsBrowserOAuth(selectedOption)) return;
    await oauthFlow.begin({
      provider: selectedOption.provider,
      displayName: displayName.trim() || selectedOption.label,
      defaultModel: defaultModel.trim() || undefined,
    });
  }

  function secretLabel(option: ProviderOption): string {
    if (option.secretMode === "oauth") return "OAuth bundle JSON";
    if (option.secretMode === "privateKey") return "Private key";
    if (option.secretMode === "githubApp") return "GitHub App private key";
    return "Secret value";
  }

  function secretPlaceholder(option: ProviderOption): string {
    if (option.secretMode === "oauth")
      return '{"accessToken":"...","refreshToken":"...","expiresAt":"..."}';
    if (option.secretMode === "privateKey" || option.secretMode === "githubApp")
      return "-----BEGIN PRIVATE KEY-----";
    return "write-only";
  }

  function statusTone(
    status: SandboxManagerCredentialProfile["status"],
  ): "good" | "warn" | "danger" | "neutral" {
    if (status === "configured") return "good";
    if (status === "invalid" || status === "revoked" || status === "expired")
      return "danger";
    if (status === "refreshing" || status === "needs_login") return "warn";
    return "neutral";
  }

  function configuredFields(
    profile: SandboxManagerCredentialProfile,
  ): { label: string; value: string }[] {
    return [
      { label: "Site", value: profile.siteUrl ?? "" },
      { label: "Email", value: profile.email ?? "" },
      { label: "Git author", value: profile.gitAuthorName ?? "" },
      { label: "Git email", value: profile.gitAuthorEmail ?? "" },
      { label: "Owner", value: profile.defaultOwner ?? "" },
      { label: "Repository", value: profile.defaultRepo ?? "" },
      { label: "Project", value: profile.defaultProjectKey ?? "" },
      { label: "Space", value: profile.defaultSpaceKey ?? "" },
    ].filter((field) => field.value.trim().length > 0);
  }

  function authTypeLabel(
    authType: SandboxManagerCredentialProfile["authType"],
  ): string {
    if (authType === "none") return "Profile";
    if (authType === "api_key") return "API key";
    if (authType === "github_app") return "GitHub App";
    if (authType === "ssh") return "SSH key";
    if (authType === "oauth") return "Subscription";
    return authType;
  }

  function profileSubtitle(profile: SandboxManagerCredentialProfile): string {
    const option = sections
      .flatMap((section) => section.options)
      .find((item) => item.providerKind === profile.providerKind);
    const label = option?.label ?? profile.provider ?? profile.displayName;
    const auth = authTypeLabel(profile.authType);
    const normalized = label.toLowerCase();
    if (
      (auth === "API key" && normalized.includes("api key")) ||
      (auth === "Subscription" && normalized.includes("subscription")) ||
      (auth === "SSH key" && normalized.includes("ssh")) ||
      (auth === "GitHub App" && normalized.includes("github app"))
    ) {
      return label;
    }
    return `${label} · ${auth}`;
  }

  async function saveProfile(): Promise<void> {
    if (!selectedOption) return;
    busy = true;
    error = undefined;
    saved = undefined;
    try {
      const request = buildCredentialProfileWrite(selectedOption, {
        displayName,
        secretValue,
        siteUrl,
        email,
        defaultModel,
        api,
        baseUrl,
        envJson,
        headersJson,
        compatJson,
        providerOptionsJson,
        defaultOwner,
        defaultRepo,
        defaultProjectKey,
        defaultSpaceKey,
        githubAppId,
        githubInstallationId,
        gitAuthorName: displayName,
        gitAuthorEmail: email,
      });
      await store.createCredentialProfile(request);
      saved = `Saved ${request.displayName}`;
      applyOptionDefaults(selectedOption, false);
      manualOAuthImport = false;
      addDialogOpen = false;
    } catch (saveError) {
      error = saveError instanceof Error ? saveError.message : String(saveError);
    } finally {
      busy = false;
    }
  }

  async function refreshProfile(profileId: string): Promise<void> {
    refreshingProfileId = profileId;
    error = undefined;
    saved = undefined;
    try {
      await store.refreshCredentialProfile(profileId);
      saved = "Profile refreshed";
    } catch (refreshError) {
      error = refreshError instanceof Error ? refreshError.message : String(refreshError);
    } finally {
      refreshingProfileId = undefined;
    }
  }
</script>

<SettingsShell
  groups={shellGroups}
  activeGroupId={activeDomainId}
  activeSectionId={activeSectionId}
  title="Settings"
  ariaLabel="Settings sections"
  onGroupChange={selectShellGroup}
  onSectionChange={selectShellSection}
>
  {#snippet navMeta(group)}
    {@const domain = domains.find((item) => item.id === group.id)}
    {#if domain}
      {@const count = countForDomain(domain)}
      {#if count !== undefined}
        <Badge tone={count > 0 ? "accent" : "neutral"} size="xs">
          {count}
        </Badge>
      {/if}
    {/if}
  {/snippet}

  {#snippet panelActions(_group)}
    {#if store.managerStatus?.hardening.apiAuth === "disabled"}
      <Badge tone="warn" size="xs">auth disabled</Badge>
    {/if}
    <Badge tone="accent" size="sm">{configuredCount} profiles</Badge>
    <Button variant="outline" size="sm" onclick={() => void store.refreshCredentials()}>
      <RefreshCw class="size-4" /> Refresh
    </Button>
  {/snippet}

  {#snippet children(_group)}
    {#if appearanceActive}
      <AppearanceSettings />
    {:else}
      {#if saved || (error && !addDialogOpen)}
        <div class="settings-section-card settings-section-card-muted" role="status" aria-live="polite">
          <div class="settings-section-body">
            {#if saved}
              <p class="flex items-center gap-2 rounded-md bg-success/10 p-2 text-xs text-success">
                <CheckCircle2 class="size-4" /> {saved}
              </p>
            {/if}
            {#if error && !addDialogOpen}
              <p class="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                <TriangleAlert class="mt-0.5 size-4 flex-none" /> {error}
              </p>
            {/if}
          </div>
        </div>
      {/if}

      {#each domainSections as section (section.id)}
        {@const sectionProfiles = profilesForSection(section)}
        <SettingsSectionCard
          section={section.id}
          title={section.label}
          description={section.description}
        >
          {#snippet actions()}
            <Badge tone="neutral" size="xs">
              {sectionProfiles.length} configured
            </Badge>
            {#if section.options.length > 0}
              <Button size="sm" onclick={() => openAddDialog(section.id)}>
                <Plus class="size-4" /> Add configuration
              </Button>
            {/if}
          {/snippet}

          {#if section.options.length === 0}
            <div class="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
              {section.emptyHint}
            </div>
          {/if}

          {#if sectionProfiles.length === 0}
            {#if section.options.length > 0}
              <div class="rounded-md border bg-muted/30 px-3 py-2">
                <p class="text-sm font-medium">No profiles configured.</p>
              </div>
            {/if}
          {:else}
            <div class="grid gap-3 xl:grid-cols-2">
              {#each sectionProfiles as profile (profile.profileId)}
                {@const fields = configuredFields(profile)}
                <article class="rounded-md border bg-card p-4">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 space-y-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <h3 class="truncate text-sm font-semibold">
                          {profile.displayName}
                        </h3>
                        <Badge tone={statusTone(profile.status)} size="xs">
                          {profile.status}
                        </Badge>
                      </div>
                      <p class="truncate text-xs text-muted-foreground">
                        {profileSubtitle(profile)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={refreshingProfileId === profile.profileId}
                      onclick={() => void refreshProfile(profile.profileId)}
                    >
                      <RefreshCw class="size-3" /> Refresh
                    </Button>
                  </div>

                  {#if fields.length > 0}
                    <div class="mt-3 grid gap-2 sm:grid-cols-2">
                      {#each fields as field}
                        <div class="min-w-0 rounded-md border bg-muted/30 px-2 py-1.5">
                          <p class="text-xs text-muted-foreground">{field.label}</p>
                          <p class="truncate text-xs font-medium">{field.value}</p>
                        </div>
                      {/each}
                    </div>
                  {/if}

                  {#if profile.lastError}
                    <p class="mt-3 flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                      <TriangleAlert class="mt-0.5 size-4 flex-none" /> {profile.lastError.message}
                    </p>
                  {/if}
                </article>
              {/each}
            </div>
          {/if}
        </SettingsSectionCard>
      {/each}
    {/if}
  {/snippet}
</SettingsShell>

<DialogShell
  bind:open={addDialogOpen}
  title={`Add ${activeSection.label}`}
  description={dialogDescription()}
  onOpenChange={handleAddDialogOpenChange}
>
  <div class="space-y-4 p-5">
    {#if selectedOption}
      <div class="grid gap-3 sm:grid-cols-2">
        {#if activeSection.options.length > 8}
          <div class="flex flex-col gap-1 sm:col-span-2">
            <Label>{searchLabel(selectedOption)}</Label>
            <Input bind:value={providerSearch} placeholder="Filter options…" />
          </div>
        {/if}
        {#if activeSection.options.length > 1}
          <div class="flex flex-col gap-1 sm:col-span-2">
            <Label>{selectorLabel(selectedOption)}</Label>
            <SelectField
              items={providerItems}
              value={providerKind}
              onValueChange={selectProvider}
            />
          </div>
        {:else}
          <div class="rounded-md border bg-muted/30 p-3 sm:col-span-2">
            <p class="text-xs font-medium text-muted-foreground">
              {selectorLabel(selectedOption)}
            </p>
            <p class="mt-1 text-sm font-medium">{selectedOption.label}</p>
            <p class="mt-1 text-xs text-muted-foreground">{selectedOption.detail}</p>
          </div>
        {/if}

        {#if selectedOption.providerKind === "git_identity"}
          <div class="flex flex-col gap-1">
            <Label>Author name</Label>
            <Input bind:value={displayName} placeholder="Sandbox Bot" />
          </div>
          <div class="flex flex-col gap-1">
            <Label>Author email</Label>
            <Input bind:value={email} placeholder="bot@example.com" />
          </div>
        {/if}

        {#if selectedOption.site}
          <div class="flex flex-col gap-1">
            <Label>Site URL</Label>
            <Input bind:value={siteUrl} placeholder="https://example.atlassian.net" />
          </div>
        {/if}

        {#if selectedOption.email && selectedOption.providerKind !== "git_identity"}
          <div class="flex flex-col gap-1">
            <Label>Email</Label>
            <Input bind:value={email} placeholder="you@example.com" />
          </div>
        {/if}

        {#if selectedOption.githubDefaults}
          <div class="flex flex-col gap-1">
            <Label>Default owner</Label>
            <Input bind:value={defaultOwner} placeholder="organization" />
          </div>
          <div class="flex flex-col gap-1">
            <Label>Default repository</Label>
            <Input bind:value={defaultRepo} placeholder="repository" />
          </div>
        {/if}

        {#if selectedOption.jiraDefaults}
          <div class="flex flex-col gap-1">
            <Label>Default project key</Label>
            <Input bind:value={defaultProjectKey} placeholder="ENG" />
          </div>
        {/if}

        {#if selectedOption.confluenceDefaults}
          <div class="flex flex-col gap-1">
            <Label>Default space key</Label>
            <Input bind:value={defaultSpaceKey} placeholder="DOCS" />
          </div>
        {/if}

        {#if selectedOption.secretMode === "githubApp"}
          <div class="flex flex-col gap-1">
            <Label>GitHub App ID</Label>
            <Input bind:value={githubAppId} placeholder="123456" />
          </div>
          <div class="flex flex-col gap-1">
            <Label>Installation ID</Label>
            <Input bind:value={githubInstallationId} placeholder="987654" />
          </div>
        {/if}

        {#if useBrowserOAuth(selectedOption)}
          <div class="space-y-3 sm:col-span-2">
            {#if !oauthFlow.flow}
              <div class="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
                <p class="text-sm font-medium">Connect {selectedOption.label}</p>
                <Button size="sm" disabled={oauthFlow.busy} onclick={() => void startBrowserOAuth()}>
                  {#if oauthFlow.busy}
                    <LoaderCircle class="spin size-4" /> Starting…
                  {:else}
                    <ExternalLink class="size-4" /> Login with browser
                  {/if}
                </Button>
              </div>
            {:else}
              <div class="space-y-3 rounded-md border bg-muted/30 p-3" aria-live="polite">
                {#if oauthFlow.flow.message}
                  <p class="text-sm font-medium">{oauthFlow.flow.message}</p>
                {/if}

                {#if oauthFlow.flow.status === "auth_url" && oauthFlow.flow.authUrl}
                  <Button variant="outline" size="sm" onclick={() => oauthFlow.flow?.authUrl && oauthFlow.openExternal(oauthFlow.flow.authUrl)}>
                    <ExternalLink class="size-4" /> Open login page
                  </Button>
                  {#if oauthFlow.flow.instructions}
                    <p class="text-xs text-muted-foreground">{oauthFlow.flow.instructions}</p>
                  {/if}
                {:else if oauthFlow.flow.status === "device_code" && oauthFlow.flow.deviceCode}
                  <div class="space-y-2">
                    <Button variant="outline" size="sm" onclick={() => oauthFlow.flow?.deviceCode && oauthFlow.openExternal(oauthFlow.flow.deviceCode.verificationUri)}>
                      <ExternalLink class="size-4" /> Open verification page
                    </Button>
                    <p class="text-xs text-muted-foreground">Enter this code:</p>
                    <code class="inline-flex rounded-md border bg-background px-2 py-1 font-mono text-sm font-semibold">{oauthFlow.flow.deviceCode.userCode}</code>
                  </div>
                {:else if oauthFlow.flow.status === "select" && oauthFlow.flow.options}
                  <div class="flex flex-wrap gap-2">
                    {#each oauthFlow.flow.options as option (option.id)}
                      <Button variant="outline" size="sm" disabled={oauthFlow.busy} onclick={() => void oauthFlow.selectOption(option.id)}>
                        {option.label}
                      </Button>
                    {/each}
                  </div>
                {:else if oauthFlow.flow.status === "prompt"}
                  <form
                    class="space-y-2"
                    onsubmit={(event) => {
                      event.preventDefault();
                      void oauthFlow.submitPrompt();
                    }}
                  >
                    {#if oauthFlow.flow.authUrl}
                      <Button variant="outline" size="sm" onclick={() => oauthFlow.flow?.authUrl && oauthFlow.openExternal(oauthFlow.flow.authUrl)}>
                        <ExternalLink class="size-4" /> Open login page
                      </Button>
                    {/if}
                    {#if oauthFlow.flow.instructions}
                      <p class="text-xs text-muted-foreground">{oauthFlow.flow.instructions}</p>
                    {/if}
                    <Input
                      type="text"
                      autocomplete="off"
                      placeholder={oauthFlow.flow.placeholder ?? "Paste the code or redirect URL"}
                      bind:value={oauthFlow.promptValue}
                      disabled={oauthFlow.busy}
                    />
                  </form>
                {:else if oauthFlow.flow.status === "failed"}
                  <div class="space-y-2">
                    <p class="text-sm font-medium text-destructive">Login was not completed.</p>
                    {#if oauthFlow.flow.error}
                      <p class="text-xs text-destructive">{oauthFlow.flow.error}</p>
                    {/if}
                    <Button variant="outline" size="sm" disabled={oauthFlow.busy} onclick={() => void oauthFlow.restart()}>
                      Try again
                    </Button>
                  </div>
                {:else if oauthFlow.flow.status === "succeeded"}
                  <p class="text-sm font-medium text-success">Connected to {oauthFlow.flow.providerName}.</p>
                {:else}
                  <p class="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle class="spin size-4" /> Working…
                  </p>
                {/if}
              </div>
            {/if}

            {#if oauthFlow.error}
              <p class="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                <TriangleAlert class="mt-0.5 size-4 flex-none" /> {oauthFlow.error}
              </p>
            {/if}
          </div>
        {:else if selectedOption.secretMode !== "none"}
          <div class="flex flex-col gap-1 sm:col-span-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <Label>{selectedOption.secretMode === "apiKey" ? "API key" : secretLabel(selectedOption)}</Label>
              {#if supportsBrowserOAuth(selectedOption)}
                <Button variant="ghost" size="xs" onclick={() => (manualOAuthImport = false)}>
                  Use browser login
                </Button>
              {/if}
            </div>
            {#if selectedOption.multiline}
              <Textarea bind:value={secretValue} class="min-h-28 font-mono text-xs" placeholder={secretPlaceholder(selectedOption)} />
            {:else}
              <Input bind:value={secretValue} type="password" placeholder={selectedOption.secretMode === "apiKey" ? "Paste your API key" : secretPlaceholder(selectedOption)} />
            {/if}
          </div>
        {/if}

        {#if hasAdvancedOptions(selectedOption)}
          <div class="space-y-3 rounded-md border bg-muted/20 p-3 sm:col-span-2">
            <Button
              variant="ghost"
              size="sm"
              class="w-full justify-between"
              onclick={() => (advancedOpen = !advancedOpen)}
            >
              Advanced
              <span class="text-xs text-muted-foreground">{advancedOpen ? "Hide" : "Show"}</span>
            </Button>

            {#if advancedOpen}
              <div class="grid gap-3 sm:grid-cols-2">
                <div class="flex flex-col gap-1 sm:col-span-2">
                  <Label>Display name</Label>
                  <Input bind:value={displayName} placeholder={selectedOption.label} />
                </div>

                {#if selectedOption.kind === "model_provider"}
                  <div class="flex flex-col gap-1">
                    <Label>Default model</Label>
                    {#if selectedProviderModels.length > 0}
                      <SelectField
                        items={modelItems}
                        value={defaultModel}
                        placeholder="Pick a pi-ai model"
                        onValueChange={(value) => (defaultModel = value)}
                      />
                    {:else}
                      <Input bind:value={defaultModel} placeholder={selectedOption.defaultModel ?? "model-id"} />
                    {/if}
                  </div>
                  <div class="flex flex-col gap-1">
                    <Label>pi-ai provider ID</Label>
                    <Input value={selectedOption.provider} readonly />
                  </div>
                  <div class="flex flex-col gap-1">
                    <Label>API family override</Label>
                    <Input bind:value={api} placeholder="builtin provider default" />
                  </div>
                  <div class="flex flex-col gap-1">
                    <Label>Base URL override</Label>
                    <Input bind:value={baseUrl} placeholder="builtin provider default" />
                  </div>
                  <div class="flex flex-col gap-1 sm:col-span-2">
                    <Label>Provider env JSON</Label>
                    <Textarea bind:value={envJson} class="min-h-24 font-mono text-xs" placeholder={JSON.stringify({ CLOUDFLARE_ACCOUNT_ID: "..." })} />
                  </div>
                  <div class="flex flex-col gap-1">
                    <Label>Headers JSON</Label>
                    <Textarea bind:value={headersJson} class="min-h-20 font-mono text-xs" placeholder={JSON.stringify({ "X-Title": "Nerve" })} />
                  </div>
                  <div class="flex flex-col gap-1">
                    <Label>Compat JSON</Label>
                    <Textarea bind:value={compatJson} class="min-h-20 font-mono text-xs" placeholder={JSON.stringify({ supportsStore: false })} />
                  </div>
                  <div class="flex flex-col gap-1 sm:col-span-2">
                    <Label>Provider options JSON</Label>
                    <Textarea bind:value={providerOptionsJson} class="min-h-20 font-mono text-xs" placeholder={JSON.stringify({ routing: { order: [] } })} />
                  </div>
                {/if}

                {#if supportsBrowserOAuth(selectedOption) && !manualOAuthImport}
                  <div class="sm:col-span-2">
                    <Button variant="outline" size="sm" onclick={() => (manualOAuthImport = true)}>
                      Import OAuth bundle JSON instead
                    </Button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      {#if error}
        <p class="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <TriangleAlert class="mt-0.5 size-4 flex-none" /> {error}
        </p>
      {/if}
    {/if}
  </div>

  {#snippet footer()}
    {#if selectedOption}
      <Button variant="ghost" size="sm" onclick={() => void closeAddDialog()}>Cancel</Button>
      {#if useBrowserOAuth(selectedOption)}
        {#if oauthFlow.flow?.status === "prompt"}
          <Button
            size="sm"
            disabled={oauthFlow.busy || (!oauthFlow.flow.allowEmpty && oauthFlow.promptValue.trim().length === 0)}
            onclick={() => void oauthFlow.submitPrompt()}
          >
            Submit
          </Button>
        {/if}
      {:else}
        <Button variant="outline" size="sm" onclick={() => applyOptionDefaults()}>Clear</Button>
        <Button
          size="sm"
          disabled={!canSaveProfile(selectedOption)}
          onclick={() => void saveProfile()}
        >
          <KeyRound class="size-4" /> Save configuration
        </Button>
      {/if}
    {/if}
  {/snippet}
</DialogShell>
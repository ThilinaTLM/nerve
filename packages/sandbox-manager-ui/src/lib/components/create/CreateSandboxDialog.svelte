<script lang="ts">
  import { Code2, FileText, RefreshCw, TriangleAlert } from "@lucide/svelte";
  import {
    thinkingLevels,
    type ModelInfo,
    type SandboxManagerCredentialProfile,
    type ThinkingLevel,
  } from "@nervekit/shared";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import DialogShell from "@nervekit/ui/components/ui/dialog-shell";
  import { Input } from "@nervekit/ui/components/ui/input";
  import { Label } from "@nervekit/ui/components/ui/label";
  import SelectField from "@nervekit/ui/components/ui/select-field";
  import { Separator } from "@nervekit/ui/components/ui/separator";
  import SwitchField from "@nervekit/ui/components/ui/switch-field";
  import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nervekit/ui/components/ui/tabs";
  import { Textarea } from "@nervekit/ui/components/ui/textarea";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import {
    buildCreateRequest,
    buildYamlFromDraft,
    CREATE_SANDBOX_TOOL_KEYS,
    createDraftFromStoredPreferences,
    saveCreateSandboxPreferences,
    type CreateSandboxToolKey,
  } from "../../state/create-sandbox-draft";
  import {
    formatTokens,
    modelDisplayName,
    providerDisplayName,
  } from "../../utils/model-display";

  let {
    open = $bindable(false),
    onCreated,
  }: { open?: boolean; onCreated?: (sandboxId: string) => void } = $props();

  const store = useSandboxManagerStore();
  let draft = $state(createDraftFromStoredPreferences());
  let error = $state<string | undefined>(undefined);
  let busy = $state(false);
  let activeTab = $state("form");
  let ignoreNextCloseChange = false;

  const modeItems = [
    { value: "normal", label: "Normal" },
    { value: "planning", label: "Planning" },
  ];
  const permissionItems = [
    { value: "read_only", label: "Read-only" },
    { value: "supervised", label: "Supervised" },
    { value: "autonomous", label: "Autonomous" },
  ];
  const noneProfile = { value: "", label: "None" };
  const thinkingLevelLabels: Record<ThinkingLevel, string> = {
    off: "Off",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra high",
  };
  const toolLabels: Record<CreateSandboxToolKey, string> = {
    fileInspection: "File inspection",
    fileEditing: "File editing",
    planMode: "Plan mode",
    todos: "Todos",
    shell: "Shell",
    python: "Python",
    taskManagement: "Tasks",
    explore: "Explore agents",
    web: "Web",
    jira: "Jira",
    confluence: "Confluence",
  };

  const authenticatedModelProfiles = $derived(
    store.credentialProfiles.filter(
      (profile) =>
        profile.kind === "model_provider" &&
        Boolean(profile.provider) &&
        (profile.status === "configured" || profile.status === "refreshing"),
    ),
  );
  const selectedMainProfile = $derived(
    authenticatedModelProfiles.find(
      (profile) => profile.profileId === draft.mainModelProfileId,
    ),
  );
  const modelProfileItems = $derived(
    authenticatedModelProfiles.map((profile) => ({
      value: profile.profileId,
      label: profile.provider
        ? providerDisplayName(profile.provider)
        : profile.displayName,
      detail: profileDetail(profile),
    })),
  );
  const filteredModels = $derived(
    store.models.filter((model) => model.provider === draft.mainProvider),
  );
  const modelItems = $derived(modelSelectItems(filteredModels, selectedMainProfile));
  const selectedMainModel = $derived(
    filteredModels.find((model) => model.modelId === draft.mainModel),
  );
  const thinkingLevelItems = $derived(
    thinkingLevelSelectItems(supportedThinkingLevelsForSelection()),
  );
  const gitIdentityProfileItems = $derived([
    noneProfile,
    ...store.credentialProfiles
      .filter((profile) => profile.providerKind === "git_identity")
      .map((profile) => ({ value: profile.profileId, label: profile.displayName })),
  ]);
  const gitCredentialProfileItems = $derived([
    noneProfile,
    ...store.credentialProfiles
      .filter(
        (profile) =>
          profile.kind === "git" && profile.providerKind !== "git_identity",
      )
      .map((profile) => ({ value: profile.profileId, label: profile.displayName })),
  ]);
  const selectedGitCredentialProfileId = $derived(
    draft.gitCredentialProfileIds[0] ?? "",
  );
  const githubProfileItems = $derived([
    noneProfile,
    ...store.credentialProfiles
      .filter((profile) => profile.kind === "github")
      .map((profile) => ({ value: profile.profileId, label: profile.displayName })),
  ]);
  const jiraProfileItems = $derived([
    noneProfile,
    ...store.credentialProfiles
      .filter((profile) => profile.kind === "jira")
      .map((profile) => ({ value: profile.profileId, label: profile.displayName })),
  ]);
  const confluenceProfileItems = $derived([
    noneProfile,
    ...store.credentialProfiles
      .filter((profile) => profile.kind === "confluence")
      .map((profile) => ({ value: profile.profileId, label: profile.displayName })),
  ]);
  const webProfileItems = $derived([
    noneProfile,
    ...store.credentialProfiles
      .filter((profile) => profile.kind === "web_provider")
      .map((profile) => ({ value: profile.profileId, label: profile.displayName })),
  ]);

  $effect(() => {
    if (!open) return;
    if (draft.mainModelProfileId || authenticatedModelProfiles.length === 0)
      return;
    setMainModelProfile(authenticatedModelProfiles[0]?.profileId ?? "");
  });

  $effect(() => {
    if (open) ignoreNextCloseChange = false;
  });

  $effect(() => {
    if (!draft.mainModel) {
      draft.mainThinking = "off";
      return;
    }
    if (!selectedMainModel) return;
    const supported = supportedThinkingLevelsForSelection();
    if (supported.includes(draft.mainThinking)) return;
    draft.mainThinking = supported.includes("off") ? "off" : (supported[0] ?? "off");
  });

  $effect(() => {
    if (activeTab !== "yaml" || draft.yamlDirty) return;
    syncYamlFromForm(false);
  });

  function profileDetail(profile: SandboxManagerCredentialProfile): string {
    const parts = [profile.displayName, profile.authType, profile.status];
    if (profile.defaultModel) parts.push(`default ${profile.defaultModel}`);
    return parts.join(" · ");
  }

  function modelSelectItems(
    models: ModelInfo[],
    profile: SandboxManagerCredentialProfile | undefined,
  ) {
    const items = models.map((model) => ({
      value: model.modelId,
      label: modelDisplayName(model),
      detail: formatTokens(model.contextWindow),
    }));
    if (
      profile?.defaultModel &&
      !items.some((item) => item.value === profile.defaultModel)
    ) {
      items.unshift({
        value: profile.defaultModel,
        label: profile.defaultModel,
        detail: "Profile default",
      });
    }
    return items;
  }

  function supportedThinkingLevelsForSelection(): ThinkingLevel[] {
    if (!draft.mainModel) return ["off"];
    return selectedMainModel?.supportedThinkingLevels?.length
      ? selectedMainModel.supportedThinkingLevels
      : [...thinkingLevels];
  }

  function thinkingLevelSelectItems(levels: ThinkingLevel[]) {
    return levels.map((level) => ({
      value: level,
      label: thinkingLevelLabels[level],
      detail:
        level === "off"
          ? "No extended reasoning"
          : "Extended reasoning budget",
    }));
  }

  function chooseDefaultModel(
    profile: SandboxManagerCredentialProfile,
    models: ModelInfo[],
  ): string {
    if (profile.defaultModel) return profile.defaultModel;
    const providerModel = models.find((model) => model.provider === profile.provider);
    return providerModel?.modelId ?? "";
  }

  function setMainModelProfile(profileId: string) {
    const profile = authenticatedModelProfiles.find(
      (candidate) => candidate.profileId === profileId,
    );
    draft.mainModelProfileId = profileId;
    if (!profile?.provider) return;
    draft.mainProvider = profile.provider;
    draft.mainModel = chooseDefaultModel(profile, store.models);
  }

  function syncYamlFromForm(clearError = true) {
    const result = buildYamlFromDraft(draft);
    if (!result.ok) {
      if (clearError) error = result.error;
      return;
    }
    draft.yamlSource = result.yaml;
    draft.yamlDirty = false;
    if (clearError) error = undefined;
  }

  function persistDraftPreferences() {
    if (!draft.yamlDirty) saveCreateSandboxPreferences(draft);
  }

  function reset() {
    draft = createDraftFromStoredPreferences();
    activeTab = "form";
    error = undefined;
  }

  function closeAndReset(savePreferences = true) {
    if (savePreferences) persistDraftPreferences();
    ignoreNextCloseChange = true;
    open = false;
    reset();
  }

  async function submit() {
    if (!draft.yamlDirty && !draft.mainModelProfileId) {
      error = "Choose an authenticated model provider before creating a sandbox.";
      return;
    }
    const result = buildCreateRequest(draft);
    if (!result.ok) {
      error = result.error;
      return;
    }
    error = undefined;
    busy = true;
    try {
      if (!draft.yamlDirty) saveCreateSandboxPreferences(draft);
      const sandboxId = await store.createSandbox(result.request);
      closeAndReset(false);
      onCreated?.(sandboxId);
    } catch (submitError) {
      error =
        submitError instanceof Error ? submitError.message : String(submitError);
    } finally {
      busy = false;
    }
  }
</script>

<DialogShell
  bind:open
  title="Create sandbox"
  description="Build a sandbox from a guided form or edit the generated YAML request directly."
  onOpenChange={(next) => {
    if (next) return;
    if (ignoreNextCloseChange) {
      ignoreNextCloseChange = false;
      return;
    }
    persistDraftPreferences();
    reset();
  }}
>
  <div class="flex flex-col gap-4 p-5">
    <Tabs bind:value={activeTab} class="min-h-0">
      <TabsList class="w-full">
        <TabsTrigger value="form" class="gap-2">
          <FileText class="size-4" /> Form
        </TabsTrigger>
        <TabsTrigger value="yaml" class="gap-2">
          <Code2 class="size-4" /> YAML
        </TabsTrigger>
      </TabsList>

      <TabsContent value="form" class="flex flex-col gap-5 pt-2">
        <section class="flex flex-col gap-3 rounded-md border bg-card p-3">
          <div>
            <h3 class="text-xs font-semibold text-muted-foreground uppercase">Request</h3>
            <p class="text-xs text-muted-foreground">Container image and lifecycle settings.</p>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="flex flex-col gap-1">
              <Label>Image</Label>
              <Input bind:value={draft.image} />
            </div>
            <div class="rounded-md border bg-background px-3 py-2.5">
              <SwitchField
                checked={draft.startAfterCreate}
                label="Start after create"
                description="Start the sandbox as soon as the manager saves it."
                onCheckedChange={(value) => (draft.startAfterCreate = value)}
              />
            </div>
          </div>
        </section>

        <section class="flex flex-col gap-3 rounded-md border bg-card p-3">
          <div>
            <h3 class="text-xs font-semibold text-muted-foreground uppercase">config.identity</h3>
            <p class="text-xs text-muted-foreground">Human-readable identity and optional labels.</p>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="flex flex-col gap-1">
              <Label>Display name</Label>
              <Input bind:value={draft.name} placeholder="my-sandbox" />
            </div>
            <div class="flex flex-col gap-1">
              <Label>Sandbox ID</Label>
              <Input bind:value={draft.sandboxId} placeholder="auto-generated" />
            </div>
            <div class="flex flex-col gap-1 sm:col-span-2">
              <Label>Labels</Label>
              <Input bind:value={draft.labels} placeholder="team=core, env=dev" />
            </div>
          </div>
        </section>

        <section class="flex flex-col gap-3 rounded-md border bg-card p-3">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-xs font-semibold text-muted-foreground uppercase">config.agent</h3>
              <p class="text-xs text-muted-foreground">Choose an authenticated provider, then pick one of its models.</p>
            </div>
            {#if selectedMainProfile}
              <Badge tone="good" size="xs">{selectedMainProfile.status}</Badge>
            {/if}
          </div>

          {#if authenticatedModelProfiles.length === 0}
            <div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              Add a configured model-provider credential before creating a sandbox from the form.
            </div>
          {:else}
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="flex flex-col gap-1">
                <Label>Provider</Label>
                <SelectField
                  items={modelProfileItems}
                  value={draft.mainModelProfileId}
                  placeholder="Choose provider"
                  onValueChange={setMainModelProfile}
                />
              </div>
              <div class="flex flex-col gap-1">
                <Label>Model</Label>
                <SelectField
                  items={modelItems}
                  value={draft.mainModel}
                  placeholder="Choose model"
                  disabled={!draft.mainModelProfileId || modelItems.length === 0}
                  onValueChange={(value) => (draft.mainModel = value)}
                />
                {#if draft.mainModelProfileId && modelItems.length === 0}
                  <p class="text-xs text-warning">No catalog models found for this provider.</p>
                {/if}
              </div>
              <div class="flex flex-col gap-1">
                <Label>Thinking level</Label>
                <SelectField
                  items={thinkingLevelItems}
                  value={draft.mainThinking}
                  placeholder="Choose thinking level"
                  disabled={!draft.mainModel || thinkingLevelItems.length === 0}
                  onValueChange={(value) =>
                    (draft.mainThinking = value as typeof draft.mainThinking)}
                />
              </div>
              <div class="flex flex-col gap-1">
                <Label>Mode</Label>
                <SelectField
                  items={modeItems}
                  value={draft.mode}
                  onValueChange={(value) =>
                    (draft.mode = value as typeof draft.mode)}
                />
              </div>
              <div class="flex flex-col gap-1">
                <Label>Permission level</Label>
                <SelectField
                  items={permissionItems}
                  value={draft.permissionLevel}
                  onValueChange={(value) =>
                    (draft.permissionLevel = value as typeof draft.permissionLevel)}
                />
              </div>
            </div>
          {/if}

          <div class="flex flex-col gap-1">
            <Label>Initial prompt</Label>
            <Textarea
              bind:value={draft.initialPrompt}
              class="min-h-16"
              placeholder="Optional first instruction for the sandbox agent"
            />
          </div>
        </section>

        <section class="flex flex-col gap-3 rounded-md border bg-card p-3">
          <div>
            <h3 class="text-xs font-semibold text-muted-foreground uppercase">auth</h3>
            <p class="text-xs text-muted-foreground">Optional managed credentials injected by the manager.</p>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="flex flex-col gap-1">
              <Label>Git identity profile</Label>
              <SelectField
                items={gitIdentityProfileItems}
                value={draft.gitIdentityProfileId}
                placeholder="No profile"
                onValueChange={(value) => (draft.gitIdentityProfileId = value)}
              />
            </div>
            <div class="flex flex-col gap-1">
              <Label>Git transport credential</Label>
              <SelectField
                items={gitCredentialProfileItems}
                value={selectedGitCredentialProfileId}
                placeholder="No profile"
                onValueChange={(value) => {
                  draft.gitCredentialProfileIds = value ? [value] : [];
                }}
              />
            </div>
            <div class="flex flex-col gap-1">
              <Label>GitHub profile</Label>
              <SelectField
                items={githubProfileItems}
                value={draft.githubProfileId}
                placeholder="No profile"
                onValueChange={(value) => (draft.githubProfileId = value)}
              />
            </div>
            <div class="flex flex-col gap-1">
              <Label>Jira profile</Label>
              <SelectField
                items={jiraProfileItems}
                value={draft.jiraProfileId}
                placeholder="No profile"
                onValueChange={(value) => {
                  draft.jiraProfileId = value;
                  if (value) draft.tools.jira = true;
                }}
              />
            </div>
            <div class="flex flex-col gap-1">
              <Label>Confluence profile</Label>
              <SelectField
                items={confluenceProfileItems}
                value={draft.confluenceProfileId}
                placeholder="No profile"
                onValueChange={(value) => {
                  draft.confluenceProfileId = value;
                  if (value) draft.tools.confluence = true;
                }}
              />
            </div>
            <div class="flex flex-col gap-1">
              <Label>Web provider profile</Label>
              <SelectField
                items={webProfileItems}
                value={draft.webProfileId}
                placeholder="No profile"
                onValueChange={(value) => {
                  draft.webProfileId = value;
                  if (value) draft.tools.web = true;
                }}
              />
            </div>
          </div>
        </section>

        <section class="flex flex-col gap-3 rounded-md border bg-card p-3">
          <div>
            <h3 class="text-xs font-semibold text-muted-foreground uppercase">config.tools.groups</h3>
            <p class="text-xs text-muted-foreground">Enable capabilities available inside the sandbox.</p>
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            {#each CREATE_SANDBOX_TOOL_KEYS as tool (tool)}
              <div class="rounded-md border bg-background px-3 py-2">
                <SwitchField
                  checked={draft.tools[tool]}
                  label={toolLabels[tool]}
                  onCheckedChange={(value) => (draft.tools[tool] = value)}
                />
              </div>
            {/each}
          </div>
        </section>
      </TabsContent>

      <TabsContent value="yaml" class="flex flex-col gap-3 pt-2">
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-3">
          <div class="min-w-0">
            <h3 class="text-xs font-semibold text-muted-foreground uppercase">YAML create request</h3>
            <p class="text-xs text-muted-foreground">
              {draft.yamlDirty
                ? "Using edited YAML for submit."
                : "Synced from the form until you edit this YAML."}
            </p>
          </div>
          <Button variant="outline" size="sm" onclick={() => syncYamlFromForm(true)}>
            <RefreshCw class="size-4" /> Sync from form
          </Button>
        </div>
        <Textarea
          bind:value={draft.yamlSource}
          class="min-h-80 font-mono text-xs"
          spellcheck="false"
          oninput={() => (draft.yamlDirty = true)}
        />
        <p class="text-xs text-muted-foreground">
          YAML submits the full create request: image/start/auth plus config. Controller wiring remains manager-owned.
        </p>
      </TabsContent>
    </Tabs>

    <Separator />

    {#if error}
      <p class="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
        <TriangleAlert class="mt-0.5 size-4 flex-none" />
        {error}
      </p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" size="sm" disabled={busy} onclick={() => closeAndReset()}>
      Cancel
    </Button>
    <Button size="sm" disabled={busy} onclick={submit}>Create sandbox</Button>
  {/snippet}
</DialogShell>

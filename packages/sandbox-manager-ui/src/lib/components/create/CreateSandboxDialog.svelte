<script lang="ts">
  import {
    ArrowDown,
    ArrowUp,
    Code2,
    FileText,
    Plus,
    RefreshCw,
    Trash2,
    TriangleAlert,
  } from "@lucide/svelte";
  import {
    thinkingLevels,
    type ModelInfo,
    type SandboxManagerCredentialProfile,
    type ThinkingLevel,
  } from "@nervekit/shared";
  import { Badge } from "@nervekit/shared-ui/components/ui/badge";
  import { Button } from "@nervekit/shared-ui/components/ui/button";
  import DialogShell from "@nervekit/shared-ui/components/ui/dialog-shell";
  import { Input } from "@nervekit/shared-ui/components/ui/input";
  import { Label } from "@nervekit/shared-ui/components/ui/label";
  import SelectField from "@nervekit/shared-ui/components/ui/select-field";
  import { Separator } from "@nervekit/shared-ui/components/ui/separator";
  import SwitchField from "@nervekit/shared-ui/components/ui/switch-field";
  import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nervekit/shared-ui/components/ui/tabs";
  import { Textarea } from "@nervekit/shared-ui/components/ui/textarea";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import {
    buildCreateRequest,
    buildCreateRequestFromForm,
    configInputToYaml,
    CREATE_SANDBOX_TOOL_KEYS,
    createDefaultBootPhase,
    createDefaultBootSecretEnv,
    createDraftFromStoredPreferences,
    saveCreateSandboxPreferences,
    type CreateSandboxBootMode,
    type CreateSandboxDisconnectPolicyMode,
    type CreateSandboxFirewallBackend,
    type CreateSandboxNetworkDefault,
    type CreateSandboxNetworkDns,
    type CreateSandboxToolKey,
    type CreateSandboxTriStateBoolean,
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
  let syncingYaml = $state(false);
  let lastLocalYamlSyncKey = $state("");
  let lastPreviewYamlAttemptKey = $state("");
  let lastPreviewYamlSyncKey = $state("");

  const modeItems = [
    { value: "normal", label: "Normal" },
    { value: "planning", label: "Planning" },
  ];
  const permissionItems = [
    { value: "read_only", label: "Read-only" },
    { value: "supervised", label: "Supervised" },
    { value: "autonomous", label: "Autonomous" },
  ];
  const disconnectPolicyModeItems = [
    {
      value: "exit_self",
      label: "Exit after timeout",
      detail: "Recommended: manager can garbage-collect detached sandboxes",
    },
    {
      value: "stay_reconnecting",
      label: "Stay reconnecting",
      detail: "Development or specialized controller mode",
    },
  ];
  const networkDefaultItems = [
    { value: "", label: "Runtime default", detail: "Use sandbox runtime default" },
    { value: "deny", label: "Deny by default", detail: "Allow only listed egress" },
    { value: "allow", label: "Allow by default", detail: "Deny only listed egress" },
  ];
  const networkDnsItems = [
    { value: "", label: "Runtime default" },
    { value: "system", label: "System DNS" },
    { value: "controller", label: "Controller DNS" },
    { value: "disabled", label: "Disabled" },
  ];
  const triStateBooleanItems = [
    { value: "", label: "Runtime default" },
    { value: "true", label: "Enabled" },
    { value: "false", label: "Disabled" },
  ];
  const firewallBackendItems = [
    { value: "", label: "Runtime default" },
    { value: "container", label: "Container runtime" },
    { value: "iptables", label: "iptables" },
    { value: "nftables", label: "nftables" },
    { value: "proxy", label: "Proxy" },
    { value: "cni", label: "CNI" },
    { value: "none", label: "None" },
  ];
  const bootModeItems = [
    { value: "single", label: "Single script", detail: "One setup script" },
    { value: "phases", label: "Phased steps", detail: "Ordered setup phases" },
  ];
  const bootRunAsItems = [
    { value: "sandbox", label: "sandbox", detail: "Default unprivileged user" },
    { value: "root", label: "root", detail: "Use only for privileged setup" },
  ];
  const bootPhaseRunAsItems = [
    { value: "", label: "Inherit boot default" },
    ...bootRunAsItems,
  ];
  const bootNetworkItems = [
    { value: "inherit", label: "inherit", detail: "Use sandbox network policy" },
    { value: "deny", label: "deny", detail: "No network during boot" },
    {
      value: "package_registries_only",
      label: "package registries only",
      detail: "Allow package installation endpoints",
    },
  ];
  const bootPhaseNetworkItems = [
    { value: "", label: "Inherit boot default" },
    ...bootNetworkItems,
  ];
  const bootOnFailureItems = [
    { value: "fail_sandbox", label: "Fail sandbox" },
    { value: "continue_readonly", label: "Continue read-only" },
  ];
  const bootSecretRefTypeItems = [
    { value: "env", label: "env", detail: "Read from an environment variable" },
    { value: "file", label: "file", detail: "Read from a mounted file" },
    { value: "kv", label: "kv", detail: "Resolve from a secret store" },
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

  const backendItems = $derived([
    {
      value: "",
      label: "Manager default",
      detail: store.managerStatus?.backend
        ? `Uses ${store.managerStatus.backend}`
        : "Use manager default backend",
    },
    ...(store.managerStatus?.backends ?? []).map((backend) => ({
      value: backend.kind,
      label: backend.label,
      detail: backend.available
        ? backend.runtime.version
        : backend.runtime.limitations[0] ?? "Unavailable",
      disabled: !backend.available,
    })),
  ]);
  const effectiveBackend = $derived(
    draft.backend || store.managerStatus?.backend || "auto",
  );
  const selectedBackendOption = $derived(
    store.managerStatus?.backends?.find((backend) => backend.kind === effectiveBackend),
  );
  const selectedRuntime = $derived(
    selectedBackendOption?.runtime ?? store.managerStatus?.runtime,
  );
  const ecsResourcePresets = $derived(
    selectedRuntime?.resourceOptions?.fargate?.presets ?? [],
  );
  const selectedEcsResourcePreset = $derived(
    ecsResourcePresets.find((preset) => String(preset.vcpu) === draft.vcpu) ??
      ecsResourcePresets.find((preset) => String(preset.cpuUnits) === draft.cpuUnits) ??
      ecsResourcePresets[0],
  );
  const ecsVcpuItems = $derived(
    ecsResourcePresets.map((preset) => ({
      value: String(preset.vcpu),
      label: `${preset.vcpu} vCPU`,
      detail: `${preset.cpuUnits} CPU units`,
    })),
  );
  const ecsMemoryItems = $derived(
    (selectedEcsResourcePreset?.memoryMb ?? []).map((memoryMb) => ({
      value: String(memoryMb),
      label: `${memoryMb} MB`,
    })),
  );
  const selectedBackendIsEcs = $derived(effectiveBackend === "ecs");
  const resourceHint = $derived(containerResourceHint());

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
  const mainProvider = $derived(
    selectedMainProfile?.provider ?? draft.defaultProvider,
  );
  const filteredMainModels = $derived(
    store.models.filter((model) => model.provider === mainProvider),
  );
  const modelItems = $derived(
    modelSelectItems(filteredMainModels, selectedMainProfile),
  );
  const selectedMainModel = $derived(
    filteredMainModels.find((model) => model.modelId === draft.defaultModel),
  );
  const selectedExploreProfile = $derived(
    authenticatedModelProfiles.find(
      (profile) => profile.profileId === draft.exploreModelProfileId,
    ),
  );
  const exploreProfileItems = $derived([
    {
      value: "",
      label: "Inherit main model",
      detail: mainProvider
        ? `Uses ${providerDisplayName(mainProvider)} · ${draft.defaultModel || "default model"}`
        : "Uses config.agent.defaultModel",
    },
    ...modelProfileItems,
  ]);
  const exploreProvider = $derived(
    selectedExploreProfile?.provider ?? draft.defaultExploreProvider,
  );
  const filteredExploreModels = $derived(
    store.models.filter((model) => model.provider === exploreProvider),
  );
  const exploreModelItems = $derived(
    modelSelectItems(filteredExploreModels, selectedExploreProfile),
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
  const formYamlSyncKey = $derived(currentFormYamlKey());
  const yamlStatusText = $derived(currentYamlStatusText());

  $effect(() => {
    if (!open) return;
    if (!draft.mainModelProfileId) {
      if (authenticatedModelProfiles.length === 0) return;
      setMainModelProfile(authenticatedModelProfiles[0]?.profileId ?? "");
      return;
    }
    ensureMainModelFollowsProfile();
  });

  $effect(() => {
    if (!open || !draft.tools.explore) return;
    ensureExploreModelFollowsProfile();
  });

  $effect(() => {
    if (!draft.defaultModel) {
      draft.defaultThinking = "off";
      return;
    }
    if (!selectedMainModel) return;
    const supported = supportedThinkingLevelsForSelection();
    if (supported.includes(draft.defaultThinking)) return;
    draft.defaultThinking = supported.includes("off") ? "off" : (supported[0] ?? "off");
  });

  $effect(() => {
    if (!open || draft.yamlDirty) return;
    if (!formYamlSyncKey || formYamlSyncKey === lastLocalYamlSyncKey) return;
    syncLocalYamlFromForm(false, formYamlSyncKey);
  });

  $effect(() => {
    if (!open || activeTab !== "yaml" || draft.yamlDirty || syncingYaml) return;
    if (!formYamlSyncKey || formYamlSyncKey === lastPreviewYamlAttemptKey) return;
    if (formYamlSyncKey !== lastLocalYamlSyncKey)
      syncLocalYamlFromForm(false, formYamlSyncKey);
    void syncYamlFromForm(false, formYamlSyncKey);
  });

  function setEcsVcpu(value: string): void {
    draft.vcpu = value;
    draft.cpuUnits = "";
    const preset = ecsResourcePresets.find(
      (candidate) => String(candidate.vcpu) === value,
    );
    const memory = Number(draft.memoryMb);
    if (preset && !preset.memoryMb.includes(memory)) {
      draft.memoryMb = String(preset.memoryMb[0] ?? "");
    }
  }

  function containerResourceHint(): string {
    const limitations = selectedRuntime?.limitations ?? [];
    if (!selectedRuntime) return "Backend capabilities load from manager status.";
    if (!selectedRuntime.available)
      return limitations[0] ?? "Selected backend is unavailable.";
    const supported = [
      selectedRuntime.supportsMemoryLimit ? "memory" : undefined,
      selectedRuntime.supportsCpuLimit ? "CPU" : undefined,
    ].filter(Boolean);
    return supported.length
      ? `Supports ${supported.join(" and ")} limits.`
      : "This backend does not report resource limit support.";
  }

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
    if (!draft.defaultModel) return ["off"];
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

  function modelBelongsToProvider(modelId: string, provider: string): boolean {
    if (!modelId) return false;
    return store.models.some(
      (model) => model.provider === provider && model.modelId === modelId,
    );
  }

  function ensureMainModelFollowsProfile(): void {
    const profile = selectedMainProfile;
    if (!profile?.provider) return;
    draft.defaultProvider = profile.provider;
    if (modelBelongsToProvider(draft.defaultModel, profile.provider)) return;
    draft.defaultModel = chooseDefaultModel(profile, store.models);
  }

  function ensureExploreModelFollowsProfile(): void {
    if (!draft.exploreModelProfileId) return;
    const profile = selectedExploreProfile;
    if (!profile?.provider) {
      draft.exploreModelProfileId = "";
      draft.defaultExploreProvider = "";
      draft.defaultExploreModel = "";
      return;
    }
    draft.defaultExploreProvider = profile.provider;
    if (modelBelongsToProvider(draft.defaultExploreModel, profile.provider))
      return;
    draft.defaultExploreModel = chooseDefaultModel(profile, store.models);
  }

  function setMainModelProfile(profileId: string) {
    const profile = authenticatedModelProfiles.find(
      (candidate) => candidate.profileId === profileId,
    );
    draft.mainModelProfileId = profileId;
    if (!profile?.provider) {
      draft.defaultProvider = "";
      draft.defaultModel = "";
      return;
    }
    draft.defaultProvider = profile.provider;
    draft.defaultModel = modelBelongsToProvider(draft.defaultModel, profile.provider)
      ? draft.defaultModel
      : chooseDefaultModel(profile, store.models);
  }

  function setExploreModelProfile(profileId: string) {
    const profile = authenticatedModelProfiles.find(
      (candidate) => candidate.profileId === profileId,
    );
    draft.exploreModelProfileId = profileId;
    if (!profileId || !profile?.provider) {
      draft.defaultExploreProvider = "";
      draft.defaultExploreModel = "";
      return;
    }
    draft.defaultExploreProvider = profile.provider;
    draft.defaultExploreModel = modelBelongsToProvider(
      draft.defaultExploreModel,
      profile.provider,
    )
      ? draft.defaultExploreModel
      : chooseDefaultModel(profile, store.models);
  }

  function setBootEnabled(value: boolean) {
    draft.bootEnabled = value;
    if (value && draft.bootMode === "phases" && draft.bootPhases.length === 0)
      addBootPhase();
  }

  function setBootMode(mode: string) {
    draft.bootMode = mode as CreateSandboxBootMode;
    if (draft.bootMode === "phases" && draft.bootPhases.length === 0)
      addBootPhase();
  }

  function createNextBootPhase() {
    const existingNames = new Set(
      draft.bootPhases.map((phase) => phase.name.trim()).filter(Boolean),
    );
    for (let index = 0; ; index += 1) {
      const phase = createDefaultBootPhase(index);
      if (!existingNames.has(phase.name)) return phase;
    }
  }

  function addBootPhase() {
    draft.bootPhases = [...draft.bootPhases, createNextBootPhase()];
  }

  function removeBootPhase(id: string) {
    draft.bootPhases = draft.bootPhases.filter((phase) => phase.id !== id);
  }

  function moveBootPhase(id: string, direction: -1 | 1) {
    const index = draft.bootPhases.findIndex((phase) => phase.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= draft.bootPhases.length)
      return;
    const phases = [...draft.bootPhases];
    [phases[index], phases[targetIndex]] = [phases[targetIndex], phases[index]];
    draft.bootPhases = phases;
  }

  function addBootEnv(phaseId: string) {
    const phase = draft.bootPhases.find((candidate) => candidate.id === phaseId);
    if (!phase) return;
    phase.env = [...phase.env, createDefaultBootSecretEnv()];
  }

  function removeBootEnv(phaseId: string, envId: string) {
    const phase = draft.bootPhases.find((candidate) => candidate.id === phaseId);
    if (!phase) return;
    phase.env = phase.env.filter((row) => row.id !== envId);
  }

  function currentFormYamlKey(): string {
    const result = buildCreateRequestFromForm(draft);
    if (!result.ok) return "";
    return JSON.stringify({
      config: result.request.config,
      auth: result.request.auth,
    });
  }

  function currentYamlStatusText(): string {
    if (draft.yamlDirty) return "Using edited sandbox config YAML for submit.";
    if (syncingYaml) return "Materializing YAML from the current form...";
    if (formYamlSyncKey && formYamlSyncKey === lastPreviewYamlSyncKey)
      return "Synced from the form through manager materialization.";
    if (formYamlSyncKey && formYamlSyncKey === lastLocalYamlSyncKey)
      return "Generated from the current form; manager materialization will refresh when available.";
    return "Fix form validation errors to regenerate YAML from the current form.";
  }

  function syncLocalYamlFromForm(
    clearError = false,
    syncKey = currentFormYamlKey(),
  ): boolean {
    const result = buildCreateRequestFromForm(draft);
    if (!result.ok) {
      if (clearError) error = result.error;
      return false;
    }
    draft.yamlSource = configInputToYaml(result.request.config);
    draft.yamlDirty = false;
    lastLocalYamlSyncKey = syncKey;
    if (clearError) error = undefined;
    return true;
  }

  async function syncYamlFromForm(
    clearError = true,
    syncKey = currentFormYamlKey(),
  ) {
    if (syncingYaml) return;
    if (!syncLocalYamlFromForm(clearError, syncKey)) return;

    const result = buildCreateRequestFromForm(draft);
    if (!result.ok) {
      if (clearError) error = result.error;
      return;
    }
    lastPreviewYamlAttemptKey = syncKey;
    syncingYaml = true;
    try {
      const preview = await store.previewSandboxConfigYaml(result.request);
      if (draft.yamlDirty || currentFormYamlKey() !== syncKey) return;
      draft.yamlSource = preview.yaml;
      draft.yamlDirty = false;
      lastLocalYamlSyncKey = syncKey;
      lastPreviewYamlSyncKey = syncKey;
      if (clearError) error = undefined;
    } catch (syncError) {
      if (clearError)
        error = syncError instanceof Error ? syncError.message : String(syncError);
    } finally {
      syncingYaml = false;
    }
  }

  function persistDraftPreferences() {
    if (!draft.yamlDirty) saveCreateSandboxPreferences(draft);
  }

  function reset() {
    draft = createDraftFromStoredPreferences();
    activeTab = "form";
    lastLocalYamlSyncKey = "";
    lastPreviewYamlAttemptKey = "";
    lastPreviewYamlSyncKey = "";
    error = undefined;
  }

  function closeAndReset(savePreferences = true) {
    if (savePreferences) persistDraftPreferences();
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
      const sandboxId = await store.createSandbox(
        result.request,
        draft.initialConversationPrompt,
      );
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
  description="Choose launch/container settings, then define the sandbox-agent config with a guided form or schema-native YAML."
  size="wide"
  onOpenChange={(next) => {
    if (next) return;
    closeAndReset(true);
  }}
>
  <div class="flex flex-col gap-4 p-5">
    <section class="flex flex-col gap-3 rounded-md border bg-card p-3">
      <div>
        <h3 class="text-xs font-semibold text-muted-foreground uppercase">Launch & container</h3>
        <p class="text-xs text-muted-foreground">
          Identity, labels, image, backend, and resources are manager launch inputs,
          not sandbox-agent config YAML.
        </p>
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
          <Label>Image</Label>
          <Input bind:value={draft.image} placeholder="Leave blank to use the manager default image" />
        </div>
        <div class="flex flex-col gap-1">
          <Label>Container backend</Label>
          <SelectField
            items={backendItems}
            value={draft.backend}
            placeholder="Manager default"
            onValueChange={(value) => (draft.backend = value)}
          />
        </div>
        <div class="rounded-md border bg-background px-3 py-2.5">
          <SwitchField
            checked={draft.startAfterCreate}
            label="Start after create"
            description="Start the sandbox as soon as the manager saves it."
            onCheckedChange={(value) => (draft.startAfterCreate = value)}
          />
        </div>
        <div class="flex flex-col gap-1 sm:col-span-2">
          <Label>Labels</Label>
          <Input bind:value={draft.labels} placeholder="team=core, env=dev" />
          <p class="text-xs text-muted-foreground">User labels are stored on the manager record and container.</p>
        </div>
        {#if selectedBackendIsEcs && ecsResourcePresets.length > 0}
          <div class="flex flex-col gap-1">
            <Label>vCPU</Label>
            <SelectField
              items={ecsVcpuItems}
              value={draft.vcpu}
              placeholder="1 vCPU"
              onValueChange={setEcsVcpu}
            />
          </div>
          <div class="flex flex-col gap-1">
            <Label>Memory</Label>
            <SelectField
              items={ecsMemoryItems}
              value={draft.memoryMb}
              placeholder="4096 MB"
              onValueChange={(value) => (draft.memoryMb = value)}
            />
          </div>
          <div class="flex flex-col gap-1">
            <Label>CPU units</Label>
            <Input
              value={draft.cpuUnits}
              inputmode="numeric"
              placeholder="1024"
              oninput={(event) => {
                draft.cpuUnits = event.currentTarget.value;
                if (draft.cpuUnits.trim()) draft.vcpu = "";
              }}
            />
            <p class="text-xs text-muted-foreground">Advanced ECS override; leave blank when vCPU is set.</p>
          </div>
        {:else}
          <div class="flex flex-col gap-1">
            <Label>Memory (MB)</Label>
            <Input bind:value={draft.memoryMb} inputmode="numeric" placeholder="4096" />
          </div>
          <div class="flex flex-col gap-1">
            <Label>CPU quota</Label>
            <Input bind:value={draft.vcpu} inputmode="decimal" placeholder="2" />
          </div>
        {/if}
        <p class="text-xs text-muted-foreground sm:col-span-2">{resourceHint}</p>
      </div>
    </section>

    <section class="flex flex-col gap-3 rounded-md border bg-card p-3">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h3 class="text-xs font-semibold text-muted-foreground uppercase">Manager profiles</h3>
          <p class="text-xs text-muted-foreground">
            Profile IDs stay outside the sandbox config. Syncing YAML materializes
            safe credential references into the sandbox-agent config.
          </p>
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
            <Label>Main model provider profile</Label>
            <SelectField
              items={modelProfileItems}
              value={draft.mainModelProfileId}
              placeholder="Choose provider"
              onValueChange={setMainModelProfile}
            />
          </div>
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
      {/if}
    </section>

    <section class="flex flex-col gap-3 rounded-md border bg-card p-3">
      <div>
        <h3 class="text-xs font-semibold text-muted-foreground uppercase">Sandbox config</h3>
        <p class="text-xs text-muted-foreground">
          Form and YAML edit the sandbox-agent config. The YAML is the exact
          schema-native config mounted in the container after manager materialization.
        </p>
      </div>

      <Tabs bind:value={activeTab} class="min-h-0">
        <TabsList class="w-full">
          <TabsTrigger value="form" class="gap-2">
            <FileText class="size-4" /> Form
          </TabsTrigger>
          <TabsTrigger value="yaml" class="gap-2">
            <Code2 class="size-4" /> YAML
          </TabsTrigger>
        </TabsList>

        <TabsContent value="form" class="flex flex-col gap-4 pt-2">
          <div class="flex flex-col gap-3 rounded-md border bg-background p-3">
            <div>
              <h3 class="text-xs font-semibold text-muted-foreground uppercase">config.agent</h3>
              <p class="text-xs text-muted-foreground">
                Choose the runtime model and policy defaults. Provider is synced
                from the selected Manager model-provider profile.
              </p>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="flex flex-col gap-1">
                <Label>Provider</Label>
                <Input
                  value={mainProvider ? providerDisplayName(mainProvider) : "Choose a Manager profile"}
                  readonly
                />
                <p class="text-xs text-muted-foreground">
                  Stored in <code class="font-mono">agent.defaultModel.provider</code>.
                </p>
              </div>
              <div class="flex flex-col gap-1">
                <Label>Model</Label>
                <SelectField
                  items={modelItems}
                  value={draft.defaultModel}
                  placeholder="Choose model"
                  disabled={!draft.mainModelProfileId || modelItems.length === 0}
                  onValueChange={(value) => (draft.defaultModel = value)}
                />
                {#if draft.mainModelProfileId && modelItems.length === 0}
                  <p class="text-xs text-warning">No catalog models found for this provider.</p>
                {/if}
              </div>
              <div class="flex flex-col gap-1">
                <Label>Thinking level</Label>
                <SelectField
                  items={thinkingLevelItems}
                  value={draft.defaultThinking}
                  placeholder="Choose thinking level"
                  disabled={!draft.defaultModel || thinkingLevelItems.length === 0}
                  onValueChange={(value) =>
                    (draft.defaultThinking = value as typeof draft.defaultThinking)}
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
            <div class="flex flex-col gap-1">
              <Label>Initial prompt</Label>
              <Textarea
                bind:value={draft.initialConversationPrompt}
                class="min-h-16"
                placeholder="Optional first instruction for the sandbox agent"
              />
            </div>
          </div>

          <div class="flex flex-col gap-3 rounded-md border bg-background p-3">
            <div>
              <h3 class="text-xs font-semibold text-muted-foreground uppercase">config.controller.disconnectPolicy</h3>
              <p class="text-xs text-muted-foreground">
                Decide what the sandbox-agent does if manager/controller WebSocket
                connectivity is lost. Transport URL and auth are still materialized
                by the manager when YAML is synced.
              </p>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="flex flex-col gap-1">
                <Label>Disconnect behavior</Label>
                <SelectField
                  items={disconnectPolicyModeItems}
                  value={draft.disconnectPolicyMode}
                  onValueChange={(value) =>
                    (draft.disconnectPolicyMode = value as CreateSandboxDisconnectPolicyMode)}
                />
              </div>
              {#if draft.disconnectPolicyMode === "exit_self"}
                <div class="flex flex-col gap-1">
                  <Label>Shutdown timeout (seconds)</Label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    bind:value={draft.disconnectExitAfterSeconds}
                    placeholder="300"
                  />
                  <p class="text-xs text-muted-foreground">
                    Default is 300 seconds. Reconnection before this deadline cancels shutdown.
                  </p>
                </div>
              {:else}
                <div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                  The sandbox will keep reconnecting indefinitely. Use this only
                  for development or specialized controllers.
                </div>
              {/if}
            </div>
          </div>

          <div class="flex flex-col gap-3 rounded-md border bg-background p-3">
            <div>
              <h3 class="text-xs font-semibold text-muted-foreground uppercase">config.security.network / firewall</h3>
              <p class="text-xs text-muted-foreground">
                Declare sandbox egress policy and firewall enforcement hints. Actual
                isolation depends on the selected runtime/backend support.
              </p>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="flex flex-col gap-1">
                <Label>Default network policy</Label>
                <SelectField
                  items={networkDefaultItems}
                  value={draft.securityNetworkDefault}
                  onValueChange={(value) =>
                    (draft.securityNetworkDefault = value as CreateSandboxNetworkDefault)}
                />
              </div>
              <div class="flex flex-col gap-1">
                <Label>DNS policy</Label>
                <SelectField
                  items={networkDnsItems}
                  value={draft.securityNetworkDns}
                  onValueChange={(value) =>
                    (draft.securityNetworkDns = value as CreateSandboxNetworkDns)}
                />
              </div>
              <div class="flex flex-col gap-1 sm:col-span-2">
                <Label>Allow hosts</Label>
                <Textarea
                  bind:value={draft.securityNetworkAllow}
                  class="min-h-16"
                  placeholder="api.anthropic.com, github.com"
                />
                <p class="text-xs text-muted-foreground">Comma or newline separated entries.</p>
              </div>
              <div class="flex flex-col gap-1 sm:col-span-2">
                <Label>Deny hosts</Label>
                <Textarea
                  bind:value={draft.securityNetworkDeny}
                  class="min-h-16"
                  placeholder="metadata.google.internal"
                />
              </div>
              <div class="flex flex-col gap-1 sm:col-span-2">
                <Label>Package registry hosts</Label>
                <Textarea
                  bind:value={draft.securityNetworkPackageRegistryHosts}
                  class="min-h-16"
                  placeholder="registry.npmjs.org, pypi.org, files.pythonhosted.org"
                />
                <p class="text-xs text-muted-foreground">
                  Used by boot phases set to package-registry-only network.
                </p>
              </div>
            </div>
            <div class="grid gap-3 rounded-md border bg-card p-3 sm:grid-cols-3">
              <div class="flex flex-col gap-1">
                <Label>Firewall</Label>
                <SelectField
                  items={triStateBooleanItems}
                  value={draft.securityFirewallEnabled}
                  onValueChange={(value) =>
                    (draft.securityFirewallEnabled = value as CreateSandboxTriStateBoolean)}
                />
              </div>
              <div class="flex flex-col gap-1">
                <Label>Backend</Label>
                <SelectField
                  items={firewallBackendItems}
                  value={draft.securityFirewallBackend}
                  onValueChange={(value) =>
                    (draft.securityFirewallBackend = value as CreateSandboxFirewallBackend)}
                />
              </div>
              <div class="flex flex-col gap-1">
                <Label>Enforce boot network</Label>
                <SelectField
                  items={triStateBooleanItems}
                  value={draft.securityFirewallEnforceBootPhaseNetwork}
                  onValueChange={(value) =>
                    (draft.securityFirewallEnforceBootPhaseNetwork = value as CreateSandboxTriStateBoolean)}
                />
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-3 rounded-md border bg-background p-3">
            <div>
              <h3 class="text-xs font-semibold text-muted-foreground uppercase">config.boot</h3>
              <p class="text-xs text-muted-foreground">
                Optional setup that runs in <code class="font-mono">/workspace</code>
                after source/context setup and before the agent daemon starts.
              </p>
            </div>

            <div class="rounded-md border bg-card px-3 py-2.5">
              <SwitchField
                checked={draft.bootEnabled}
                label="Enable boot steps"
                description="Add a custom script or ordered setup phases to the sandbox-agent config."
                onCheckedChange={setBootEnabled}
              />
            </div>

            {#if draft.bootEnabled}
              <div class="grid gap-3 sm:grid-cols-2">
                <div class="flex flex-col gap-1">
                  <Label>Mode</Label>
                  <SelectField
                    items={bootModeItems}
                    value={draft.bootMode}
                    onValueChange={setBootMode}
                  />
                </div>
                <div class="flex flex-col gap-1">
                  <Label>Timeout (seconds)</Label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    bind:value={draft.bootTimeoutSeconds}
                    placeholder="600"
                  />
                </div>
                <div class="flex flex-col gap-1">
                  <Label>Run as</Label>
                  <SelectField
                    items={bootRunAsItems}
                    value={draft.bootRunAs}
                    onValueChange={(value) =>
                      (draft.bootRunAs = value as typeof draft.bootRunAs)}
                  />
                  <p class="text-xs text-muted-foreground">
                    Prefer sandbox; root is for package or system setup only.
                  </p>
                </div>
                <div class="flex flex-col gap-1">
                  <Label>Network</Label>
                  <SelectField
                    items={bootNetworkItems}
                    value={draft.bootNetwork}
                    onValueChange={(value) =>
                      (draft.bootNetwork = value as typeof draft.bootNetwork)}
                  />
                  <p class="text-xs text-muted-foreground">
                    Restrict network access when setup does not need downloads.
                  </p>
                </div>
                <div class="flex flex-col gap-1 sm:col-span-2">
                  <Label>On failure</Label>
                  <SelectField
                    items={bootOnFailureItems}
                    value={draft.bootOnFailure}
                    onValueChange={(value) =>
                      (draft.bootOnFailure = value as typeof draft.bootOnFailure)}
                  />
                </div>
              </div>

              {#if draft.bootMode === "single"}
                <div class="flex flex-col gap-1">
                  <Label>Script</Label>
                  <Textarea
                    bind:value={draft.bootScript}
                    class="min-h-32 font-mono text-xs"
                    placeholder="git clone https://github.com/acme/project.git .&#10;pnpm install"
                  />
                  <p class="text-xs text-muted-foreground">
                    Runs in <code class="font-mono">/workspace</code> after git/GitHub
                    setup and skills/context loading, before the agent daemon starts.
                  </p>
                </div>
              {:else}
                <div class="flex flex-col gap-3">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <h4 class="text-sm font-medium">Phases</h4>
                      <p class="text-xs text-muted-foreground">
                        Phases run from top to bottom. Use overrides only when a
                        phase differs from the boot defaults.
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onclick={addBootPhase}>
                      <Plus class="size-4" /> Add phase
                    </Button>
                  </div>

                  {#if draft.bootPhases.length === 0}
                    <div class="rounded-md border border-dashed bg-card p-3 text-sm text-muted-foreground">
                      Add at least one phase to build <code class="font-mono">boot.phases</code>.
                    </div>
                  {:else}
                    {#each draft.bootPhases as phase, index (phase.id)}
                      <div class="flex flex-col gap-3 rounded-md border bg-card p-3">
                        <div class="flex items-start justify-between gap-3">
                          <div>
                            <h4 class="text-sm font-medium">Phase {index + 1}</h4>
                            <p class="text-xs text-muted-foreground">
                              Name, script, optional overrides, and secret refs.
                            </p>
                          </div>
                          <div class="flex shrink-0 items-center gap-1">
                            <Button
                              variant="outline"
                              size="icon-sm"
                              ariaLabel="Move phase up"
                              disabled={index === 0}
                              onclick={() => moveBootPhase(phase.id, -1)}
                            >
                              <ArrowUp class="size-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="icon-sm"
                              ariaLabel="Move phase down"
                              disabled={index === draft.bootPhases.length - 1}
                              onclick={() => moveBootPhase(phase.id, 1)}
                            >
                              <ArrowDown class="size-4" />
                            </Button>
                            <Button
                              variant="destructive"
                              size="icon-sm"
                              ariaLabel="Remove phase"
                              onclick={() => removeBootPhase(phase.id)}
                            >
                              <Trash2 class="size-4" />
                            </Button>
                          </div>
                        </div>

                        <div class="grid gap-3 sm:grid-cols-2">
                          <div class="flex flex-col gap-1">
                            <Label>Name</Label>
                            <Input bind:value={phase.name} placeholder="setup" />
                          </div>
                          <div class="flex flex-col gap-1">
                            <Label>Timeout override (seconds)</Label>
                            <Input
                              type="number"
                              min="1"
                              step="1"
                              bind:value={phase.timeoutSeconds}
                              placeholder="Inherit"
                            />
                          </div>
                          <div class="flex flex-col gap-1">
                            <Label>Run as override</Label>
                            <SelectField
                              items={bootPhaseRunAsItems}
                              value={phase.runAs}
                              placeholder="Inherit boot default"
                              onValueChange={(value) =>
                                (phase.runAs = value as typeof phase.runAs)}
                            />
                          </div>
                          <div class="flex flex-col gap-1">
                            <Label>Network override</Label>
                            <SelectField
                              items={bootPhaseNetworkItems}
                              value={phase.network}
                              placeholder="Inherit boot default"
                              onValueChange={(value) =>
                                (phase.network = value as typeof phase.network)}
                            />
                          </div>
                        </div>

                        <div class="flex flex-col gap-1">
                          <Label>Script</Label>
                          <Textarea
                            bind:value={phase.script}
                            class="min-h-28 font-mono text-xs"
                            placeholder="pnpm install"
                          />
                        </div>

                        <details class="rounded-md border bg-background p-3">
                          <summary class="cursor-pointer text-sm font-medium">
                            Secret environment
                          </summary>
                          <div class="mt-3 flex flex-col gap-3">
                            <p class="text-xs text-muted-foreground">
                              Add environment variables backed by secret refs. Raw
                              secret values are not accepted here.
                            </p>
                            {#if phase.env.length === 0}
                              <p class="rounded-md border border-dashed bg-card p-3 text-xs text-muted-foreground">
                                No secret refs for this phase.
                              </p>
                            {:else}
                              {#each phase.env as row (row.id)}
                                <div class="grid gap-2 rounded-md border bg-card p-2 md:grid-cols-4">
                                  <div class="flex flex-col gap-1">
                                    <Label>Variable</Label>
                                    <Input bind:value={row.name} placeholder="API_TOKEN" />
                                  </div>
                                  <div class="flex flex-col gap-1">
                                    <Label>Ref type</Label>
                                    <SelectField
                                      items={bootSecretRefTypeItems}
                                      value={row.refType}
                                      onValueChange={(value) =>
                                        (row.refType = value as typeof row.refType)}
                                    />
                                  </div>
                                  <div class="flex flex-col gap-1">
                                    <Label>{row.refType === "env"
                                      ? "Source env"
                                      : row.refType === "file"
                                        ? "File path"
                                        : "Key"}</Label>
                                    <Input
                                      bind:value={row.value}
                                      placeholder={row.refType === "file"
                                        ? "/run/secrets/token"
                                        : row.refType === "kv"
                                          ? "api-token"
                                          : "HOST_API_TOKEN"}
                                    />
                                  </div>
                                  <div class="flex items-end">
                                    <Button
                                      variant="destructive"
                                      size="icon-sm"
                                      ariaLabel="Remove secret environment ref"
                                      onclick={() => removeBootEnv(phase.id, row.id)}
                                    >
                                      <Trash2 class="size-4" />
                                    </Button>
                                  </div>
                                  {#if row.refType === "kv"}
                                    <div class="flex flex-col gap-1 md:col-span-2">
                                      <Label>Store</Label>
                                      <Input bind:value={row.store} placeholder="Optional store" />
                                    </div>
                                    <div class="flex flex-col gap-1 md:col-span-2">
                                      <Label>Version</Label>
                                      <Input bind:value={row.version} placeholder="Optional version" />
                                    </div>
                                  {/if}
                                </div>
                              {/each}
                            {/if}
                            <Button
                              variant="outline"
                              size="sm"
                              onclick={() => addBootEnv(phase.id)}
                            >
                              <Plus class="size-4" /> Add secret ref
                            </Button>
                          </div>
                        </details>
                      </div>
                    {/each}
                  {/if}
                </div>
              {/if}
            {/if}
          </div>

          <div class="flex flex-col gap-3 rounded-md border bg-background p-3">
            <div>
              <h3 class="text-xs font-semibold text-muted-foreground uppercase">config.tools.groups</h3>
              <p class="text-xs text-muted-foreground">Enable capabilities available inside the sandbox.</p>
            </div>
            <div class="grid gap-2 sm:grid-cols-2">
              {#each CREATE_SANDBOX_TOOL_KEYS as tool (tool)}
                <div class="rounded-md border bg-card px-3 py-2">
                  <SwitchField
                    checked={draft.tools[tool]}
                    label={toolLabels[tool]}
                    onCheckedChange={(value) => (draft.tools[tool] = value)}
                  />
                </div>
              {/each}
            </div>

            {#if draft.tools.explore}
              <div class="flex flex-col gap-3 rounded-md border bg-card p-3">
                <div>
                  <h4 class="text-sm font-medium">config.agent.defaultExploreModel</h4>
                  <p class="text-xs text-muted-foreground">
                    Optional default model for explore sub-agents. Leave inherited
                    to use the main agent model.
                  </p>
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <div class="flex flex-col gap-1">
                    <Label>Explore provider profile</Label>
                    <SelectField
                      items={exploreProfileItems}
                      value={draft.exploreModelProfileId}
                      placeholder="Inherit main model"
                      onValueChange={setExploreModelProfile}
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <Label>Explore model</Label>
                    <SelectField
                      items={exploreModelItems}
                      value={draft.defaultExploreModel}
                      placeholder="Inherit main model"
                      disabled={!draft.exploreModelProfileId || exploreModelItems.length === 0}
                      onValueChange={(value) => (draft.defaultExploreModel = value)}
                    />
                    {#if draft.exploreModelProfileId && exploreModelItems.length === 0}
                      <p class="text-xs text-warning">No catalog models found for this provider.</p>
                    {/if}
                  </div>
                </div>
              </div>
            {/if}
          </div>
        </TabsContent>

        <TabsContent value="yaml" class="flex flex-col gap-3 pt-2">
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3">
            <div class="min-w-0">
              <h3 class="text-xs font-semibold text-muted-foreground uppercase">SandboxConfigV1 YAML</h3>
              <p class="text-xs text-muted-foreground">{yamlStatusText}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={syncingYaml}
              onclick={() => void syncYamlFromForm(true)}
            >
              <RefreshCw class="size-4" /> Sync from form
            </Button>
          </div>
          <Textarea
            bind:value={draft.yamlSource}
            class="min-h-80 font-mono text-xs"
            spellcheck="false"
            placeholder="version: 1"
            oninput={() => (draft.yamlDirty = true)}
          />
          <p class="text-xs text-muted-foreground">
            YAML contains only the sandbox-agent config. Identity, labels, image,
            backend, resources, start behavior, and manager profile selectors live
            outside this YAML. The created sandbox page shows the exact mounted YAML.
          </p>
        </TabsContent>
      </Tabs>
    </section>

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
    <Button size="sm" disabled={busy || syncingYaml} onclick={submit}>Create sandbox</Button>
  {/snippet}
</DialogShell>
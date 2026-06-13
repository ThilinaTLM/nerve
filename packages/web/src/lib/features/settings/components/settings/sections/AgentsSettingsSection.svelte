<script lang="ts">
  import Bot from "@lucide/svelte/icons/bot";
  import type { Settings, UpdateSettingsRequest } from "$lib/api";
  import RadioGroup from "$lib/components/ui/radio-group-field";
  import { modeItems, permissionItems } from "../options";

  type SettingsChange = (
    patch: UpdateSettingsRequest,
    options?: { immediate?: boolean; debounceMs?: number },
  ) => void;

  type Props = {
    settingsDraft: Settings;
    onSettingsChange?: SettingsChange;
  };

  let { settingsDraft, onSettingsChange }: Props = $props();

  function writePolicy(permission: Settings["defaultPermissionLevel"] | undefined): string {
    if (permission === "read_only") return "Denied";
    if (permission === "supervised") return "Approval required";
    if (permission === "autonomous") return "Allowed";
    return "Policy-managed";
  }

  function commandPolicy(permission: Settings["defaultPermissionLevel"] | undefined): string {
    if (permission === "read_only") return "Denied";
    if (permission === "supervised") return "Approval required";
    if (permission === "autonomous") return "Allowed";
    return "Policy-managed";
  }
</script>

<section id="settings-agents" class="settings-section" data-section="agents">
  <header class="settings-section-header">
    <div class="settings-section-kicker"><Bot size={14} strokeWidth={2.1} /> Agents</div>
    <h2>Default behavior and policy</h2>
    <p>Defaults apply to newly created root agents and subagents.</p>
  </header>
  <div class="settings-section-body">
    <div class="settings-control-grid">
      <div class="settings-row settings-row-stacked">
        <div class="settings-copy">
          <strong>Root mode</strong>
          <span>The starting workflow for new top-level agents.</span>
        </div>
        <RadioGroup
          items={modeItems}
          value={settingsDraft.defaultMode}
          ariaLabel="Default root mode"
          onValueChange={(value) => {
            const next = value as Settings["defaultMode"];
            settingsDraft.defaultMode = next;
            onSettingsChange?.({ defaultMode: next }, { immediate: true });
          }}
        />
      </div>
      <div class="settings-row settings-row-stacked">
        <div class="settings-copy">
          <strong>Root permission</strong>
          <span>The approval policy for new top-level agents.</span>
        </div>
        <RadioGroup
          items={permissionItems}
          value={settingsDraft.defaultPermissionLevel}
          ariaLabel="Default root permission"
          onValueChange={(value) => {
            const next = value as Settings["defaultPermissionLevel"];
            settingsDraft.defaultPermissionLevel = next;
            onSettingsChange?.({ defaultPermissionLevel: next }, { immediate: true });
          }}
        />
      </div>
      <div class="settings-row settings-row-stacked">
        <div class="settings-copy">
          <strong>Subagent mode</strong>
          <span>The starting workflow for agents spawned by another agent.</span>
        </div>
        <RadioGroup
          items={modeItems}
          value={settingsDraft.defaultSubagentMode}
          ariaLabel="Default subagent mode"
          onValueChange={(value) => {
            const next = value as Settings["defaultSubagentMode"];
            settingsDraft.defaultSubagentMode = next;
            onSettingsChange?.({ defaultSubagentMode: next }, { immediate: true });
          }}
        />
      </div>
      <div class="settings-row settings-row-stacked">
        <div class="settings-copy">
          <strong>Subagent permission</strong>
          <span>The approval policy for spawned agents.</span>
        </div>
        <RadioGroup
          items={permissionItems}
          value={settingsDraft.defaultSubagentPermissionLevel}
          ariaLabel="Default subagent permission"
          onValueChange={(value) => {
            const next = value as Settings["defaultSubagentPermissionLevel"];
            settingsDraft.defaultSubagentPermissionLevel = next;
            onSettingsChange?.({ defaultSubagentPermissionLevel: next }, { immediate: true });
          }}
        />
      </div>
    </div>

    <div class="permission-table" role="table" aria-label="Default agent permissions">
      <div role="row"><span role="columnheader">Capability</span><span role="columnheader">Default policy</span></div>
      <div role="row"><span>File system read</span><strong>Allowed</strong></div>
      <div role="row"><span>File system write</span><strong>{writePolicy(settingsDraft.defaultPermissionLevel)}</strong></div>
      <div role="row">
        <span>Terminal command execution</span><strong>{commandPolicy(settingsDraft.defaultPermissionLevel)}</strong>
      </div>
      <div role="row"><span>Network access</span><strong>Tool-dependent</strong></div>
    </div>
  </div>
</section>

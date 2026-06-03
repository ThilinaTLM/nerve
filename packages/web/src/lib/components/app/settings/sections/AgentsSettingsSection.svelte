<script lang="ts">
  import Bot from "@lucide/svelte/icons/bot";
  import type { Settings } from "../../../../api";
  import RadioGroup from "$lib/components/ui/radio-group-field";
  import { modeItems, permissionItems } from "../options";

  type Props = {
    settingsDraft: Settings;
  };

  let { settingsDraft }: Props = $props();

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
      <RadioGroup
        items={modeItems}
        value={settingsDraft.defaultMode}
        ariaLabel="Default root mode"
        onValueChange={(value) => {
          settingsDraft.defaultMode = value as Settings["defaultMode"];
        }}
      />
    </div>
    <div class="control-block">
      <h3>Root permission</h3>
      <RadioGroup
        items={permissionItems}
        value={settingsDraft.defaultPermissionLevel}
        ariaLabel="Default root permission"
        onValueChange={(value) => {
          settingsDraft.defaultPermissionLevel = value as Settings["defaultPermissionLevel"];
        }}
      />
    </div>
    <div class="control-block">
      <h3>Subagent mode</h3>
      <RadioGroup
        items={modeItems}
        value={settingsDraft.defaultSubagentMode}
        ariaLabel="Default subagent mode"
        onValueChange={(value) => {
          settingsDraft.defaultSubagentMode = value as Settings["defaultSubagentMode"];
        }}
      />
    </div>
    <div class="control-block">
      <h3>Subagent permission</h3>
      <RadioGroup
        items={permissionItems}
        value={settingsDraft.defaultSubagentPermissionLevel}
        ariaLabel="Default subagent permission"
        onValueChange={(value) => {
          settingsDraft.defaultSubagentPermissionLevel = value as Settings["defaultSubagentPermissionLevel"];
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
</section>

<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Save from "@lucide/svelte/icons/save";
  import { Button } from "$lib/components/ui/button";
  import type { SettingsSection } from "./options";

  type Props = {
    activeSection: SettingsSection;
    canSave?: boolean;
    onBack?: () => void;
    onLoadSettings?: () => void;
    onSaveSettings?: () => void;
  };

  let {
    activeSection,
    canSave = false,
    onBack,
    onLoadSettings,
    onSaveSettings,
  }: Props = $props();
</script>

<header class="settings-header">
  <div class="heading-block">
    <span class="breadcrumb">nerve <b>/</b> settings <b>/</b> <em>{activeSection}</em></span>
    <h1>Workbench Settings</h1>
    <p>Control app appearance, agent defaults, compaction, server binding, and provider access.</p>
  </div>
  <div class="header-actions">
    <Button variant="secondary" size="sm" onclick={onBack}>
      <ArrowLeft size={13} strokeWidth={2.25} />Workspace
    </Button>
    <Button variant="ghost" size="sm" onclick={onLoadSettings}>
      <RefreshCw size={13} strokeWidth={2.25} />Refresh
    </Button>
    <Button size="sm" onclick={onSaveSettings} disabled={!canSave}>
      <Save size={13} strokeWidth={2.25} />Save settings
    </Button>
  </div>
</header>

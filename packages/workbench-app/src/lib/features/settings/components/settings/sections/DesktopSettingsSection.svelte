<script lang="ts">
import type { Settings, UpdateSettingsRequest } from "$lib/api";
import Switch from "@nervekit/ui-kit/components/ui/switch-field";
import { SettingsSectionCard } from "@nervekit/workbench-ui/components/settings";

type SettingsChange = (
  patch: UpdateSettingsRequest,
  options?: { immediate?: boolean; debounceMs?: number },
) => void;

type Props = {
  settingsDraft: Settings;
  onSettingsChange?: SettingsChange;
};

let { settingsDraft, onSettingsChange }: Props = $props();
</script>

<SettingsSectionCard section="desktop" title="Desktop">
  <div class="settings-row">
    <Switch
      class="settings-full-switch"
      bind:checked={settingsDraft.desktop.closeToTray}
      label="Close to system tray"
      description="Hide Nerve in the tray instead of quitting."
      onCheckedChange={(checked) => {
        settingsDraft.desktop.closeToTray = checked;
        onSettingsChange?.(
          { desktop: { closeToTray: checked } },
          { immediate: true },
        );
      }}
    />
  </div>
</SettingsSectionCard>

<script lang="ts">
import type { Settings, UpdateSettingsRequest } from "$lib/api";
import Switch from "@nervekit/ui-kit/components/ui/switch-field";
import { SettingsSectionCard } from "$lib/presentation/components/settings";

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

<SettingsSectionCard section="notifications" title="Notifications">
  <div class="settings-row">
    <Switch
      class="settings-full-switch"
      bind:checked={settingsDraft.notifications.systemEnabled}
      label="System notifications"
      description="Show agent updates through desktop or browser notifications."
      onCheckedChange={(checked) => {
        settingsDraft.notifications.systemEnabled = checked;
        onSettingsChange?.(
          { notifications: { systemEnabled: checked } },
          { immediate: true },
        );
      }}
    />
  </div>
  <div class="settings-row">
    <Switch
      class="settings-full-switch"
      bind:checked={settingsDraft.notifications.soundsEnabled}
      label="Notification sounds"
      description="Play subtle sounds for attention, completion, and failures."
      onCheckedChange={(checked) => {
        settingsDraft.notifications.soundsEnabled = checked;
        onSettingsChange?.(
          { notifications: { soundsEnabled: checked } },
          { immediate: true },
        );
      }}
    />
  </div>
</SettingsSectionCard>

<script lang="ts">
  import type { Settings, UpdateSettingsRequest } from "$lib/api";
  import Switch from "$lib/components/ui/switch-field";

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

<section id="settings-desktop" class="settings-section" data-section="desktop">
  <header class="settings-section-header">
    <h2>Desktop</h2>
  </header>
  <div class="settings-section-body">
    <div class="settings-row">
      <Switch
        class="settings-full-switch"
        bind:checked={settingsDraft.desktop.closeToTray}
        label="Close to system tray"
        description="Hide Nerve in the tray instead of quitting."
        onCheckedChange={(checked) => {
          settingsDraft.desktop.closeToTray = checked;
          onSettingsChange?.({ desktop: { closeToTray: checked } }, { immediate: true });
        }}
      />
    </div>
  </div>
</section>

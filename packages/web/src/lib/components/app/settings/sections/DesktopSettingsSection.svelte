<script lang="ts">
  import AppWindow from "@lucide/svelte/icons/app-window";
  import type { Settings, UpdateSettingsRequest } from "../../../../api";
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
    <div class="settings-section-kicker"><AppWindow size={14} strokeWidth={2.1} /> Desktop</div>
    <h2>Window close behavior</h2>
    <p>Choose whether the desktop app keeps running in the tray after the window is closed.</p>
  </header>
  <div class="settings-section-body">
    <div class="settings-row">
      <Switch
        class="settings-full-switch"
        bind:checked={settingsDraft.desktop.closeToTray}
        label="Close to system tray"
        description="When enabled, the Close button hides Nerve to the tray. When disabled, Close quits the desktop app."
        onCheckedChange={(checked) => {
          settingsDraft.desktop.closeToTray = checked;
          onSettingsChange?.({ desktop: { closeToTray: checked } }, { immediate: true });
        }}
      />
    </div>
  </div>
</section>

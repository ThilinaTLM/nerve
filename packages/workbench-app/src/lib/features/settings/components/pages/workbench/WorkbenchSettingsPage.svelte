<script lang="ts">
import type { Settings } from "$lib/api";
import type { ThemePreference } from "$lib/app/shell/appearance.svelte";
import {
  SettingsRow,
  SettingsSection,
  SettingsToggleRow,
} from "$lib/presentation/components/settings";
import type { SettingsChange } from "../settings-change";
import ThemePreviewPicker from "./ThemePreviewPicker.svelte";

type Props = {
  settingsDraft: Settings;
  onThemeChange?: (theme: ThemePreference) => void;
  onSettingsChange?: SettingsChange;
};

let { settingsDraft, onThemeChange, onSettingsChange }: Props = $props();

function setThemePreference(value: string): void {
  const preference = value as ThemePreference;
  settingsDraft.ui.theme = preference;
  onThemeChange?.(preference);
  onSettingsChange?.({ ui: { theme: preference } }, { immediate: true });
}

function setCloseToTray(checked: boolean): void {
  settingsDraft.desktop.closeToTray = checked;
  onSettingsChange?.(
    { desktop: { closeToTray: checked } },
    { immediate: true },
  );
}
</script>

<SettingsSection id="appearance" title="Appearance">
  <SettingsRow label="Color theme" layout="stacked">
    <ThemePreviewPicker
      value={settingsDraft.ui.theme}
      onValueChange={setThemePreference}
    />
  </SettingsRow>
</SettingsSection>

<SettingsSection id="desktop" title="Desktop">
  <SettingsToggleRow
    label="Close to system tray"
    description="Hide Nerve in the tray instead of quitting."
    bind:checked={settingsDraft.desktop.closeToTray}
    onCheckedChange={setCloseToTray}
  />
</SettingsSection>

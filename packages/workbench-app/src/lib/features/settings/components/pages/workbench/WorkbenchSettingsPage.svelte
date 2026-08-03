<script lang="ts">
import type { ColorMode, ColorTheme, Settings } from "$lib/api";
import {
  SettingsRow,
  SettingsSection,
  SettingsToggleRow,
} from "$lib/presentation/components/settings";
import type { SettingsChange } from "../settings-change";
import ColorModePicker from "./ColorModePicker.svelte";
import ThemePreviewPicker from "./ThemePreviewPicker.svelte";

type Props = {
  settingsDraft: Settings;
  onColorThemeChange?: (theme: ColorTheme) => void;
  onColorModeChange?: (colorMode: ColorMode) => void;
  onSettingsChange?: SettingsChange;
};

let {
  settingsDraft,
  onColorThemeChange,
  onColorModeChange,
  onSettingsChange,
}: Props = $props();

function setColorTheme(value: string): void {
  const theme = value as ColorTheme;
  settingsDraft.ui.theme = theme;
  onColorThemeChange?.(theme);
  onSettingsChange?.({ ui: { theme } }, { immediate: true });
}

function setColorMode(value: string): void {
  const colorMode = value as ColorMode;
  settingsDraft.ui.colorMode = colorMode;
  onColorModeChange?.(colorMode);
  onSettingsChange?.({ ui: { colorMode } }, { immediate: true });
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
  <SettingsRow label="Theme" layout="stacked">
    <ThemePreviewPicker
      value={settingsDraft.ui.theme}
      onValueChange={setColorTheme}
    />
  </SettingsRow>
  <SettingsRow label="Color mode" layout="stacked">
    <ColorModePicker
      value={settingsDraft.ui.colorMode}
      theme={settingsDraft.ui.theme}
      onValueChange={setColorMode}
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

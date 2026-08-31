<script lang="ts">
import type { ColorMode, ColorTheme, HeaderType, Settings } from "$lib/api";
import {
  SettingsRow,
  SettingsSection,
  SettingsSelectRow,
  SettingsToggleRow,
} from "$lib/presentation/settings";
import type { SettingsChange } from "../settings-change";
import ColorModePicker from "./ColorModePicker.svelte";
import ThemePreviewPicker from "./ThemePreviewPicker.svelte";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";

const headerTypeOptions = [
  { value: "auto", label: "Auto" },
  { value: "linux", label: "Linux" },
  { value: "windows", label: "Windows" },
  { value: "macos", label: "macOS" },
];

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

function setHeaderType(value: string): void {
  const headerType = value as HeaderType;
  settingsDraft.desktop.headerType = headerType;
  onSettingsChange?.({ desktop: { headerType } }, { immediate: true });
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
  <SettingsSelectRow
    label="Header style"
    description="Auto follows your operating system. Choose another style to override it."
  >
    {#snippet control(disabled)}
      <SelectField
        items={headerTypeOptions}
        value={settingsDraft.desktop.headerType}
        ariaLabel="Header style"
        {disabled}
        onValueChange={setHeaderType}
      />
    {/snippet}
  </SettingsSelectRow>
  <SettingsToggleRow
    label="Close to system tray"
    description="Hide Nerve in the tray instead of quitting."
    bind:checked={settingsDraft.desktop.closeToTray}
    onCheckedChange={setCloseToTray}
  />
</SettingsSection>

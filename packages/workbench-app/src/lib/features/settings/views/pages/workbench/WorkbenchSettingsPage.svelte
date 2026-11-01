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
  lightTheme: ColorTheme;
  darkTheme: ColorTheme;
  colorMode: ColorMode;
  onLightThemeChange?: (theme: ColorTheme) => void;
  onDarkThemeChange?: (theme: ColorTheme) => void;
  onColorModeChange?: (colorMode: ColorMode) => void;
  onSettingsChange?: SettingsChange;
};

let {
  settingsDraft,
  lightTheme,
  darkTheme,
  colorMode,
  onLightThemeChange,
  onDarkThemeChange,
  onColorModeChange,
  onSettingsChange,
}: Props = $props();

function setLightTheme(value: string): void {
  onLightThemeChange?.(value as ColorTheme);
}

function setDarkTheme(value: string): void {
  onDarkThemeChange?.(value as ColorTheme);
}

function setColorMode(value: string): void {
  const colorMode = value as ColorMode;
  onColorModeChange?.(colorMode);
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
  <SettingsRow label="Color mode" layout="stacked">
    <ColorModePicker
      value={colorMode}
      {lightTheme}
      {darkTheme}
      onValueChange={setColorMode}
    />
  </SettingsRow>
  <SettingsRow label="Light theme" layout="stacked">
    <ThemePreviewPicker
      kind="light"
      value={lightTheme}
      onValueChange={setLightTheme}
    />
  </SettingsRow>
  <SettingsRow label="Dark theme" layout="stacked">
    <ThemePreviewPicker
      kind="dark"
      value={darkTheme}
      onValueChange={setDarkTheme}
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

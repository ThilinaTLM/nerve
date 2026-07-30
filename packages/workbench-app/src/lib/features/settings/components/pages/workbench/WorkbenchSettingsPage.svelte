<script lang="ts">
import type { Settings } from "$lib/api";
import type { ThemePreference } from "$lib/app/shell/appearance.svelte";
import {
  SettingsChoiceCards,
  SettingsGroup,
  SettingsRow,
  SettingsToggleRow,
} from "$lib/presentation/components/settings";
import type { SettingsChange } from "../settings-change";
import { themeItems } from "./appearance-options";

type Props = {
  activeTabId: string;
  settingsDraft: Settings;
  onThemeChange?: (theme: ThemePreference) => void;
  onSettingsChange?: SettingsChange;
};

let { activeTabId, settingsDraft, onThemeChange, onSettingsChange }: Props =
  $props();

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

{#if activeTabId === "appearance"}
  <SettingsGroup>
    <SettingsRow label="Color theme" layout="stacked">
      <SettingsChoiceCards
        items={themeItems}
        value={settingsDraft.ui.theme}
        columns={3}
        ariaLabel="Theme preference"
        onValueChange={setThemePreference}
      />
    </SettingsRow>
  </SettingsGroup>
{:else if activeTabId === "desktop"}
  <SettingsGroup>
    <SettingsToggleRow
      label="Close to system tray"
      description="Hide Nerve in the tray instead of quitting."
      bind:checked={settingsDraft.desktop.closeToTray}
      onCheckedChange={setCloseToTray}
    />
  </SettingsGroup>
{/if}

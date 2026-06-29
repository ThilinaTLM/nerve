<script lang="ts">
  import type { Settings, UpdateSettingsRequest } from "$lib/api";
  import type { ThemePreference } from "$lib/app/layout/layout-state.svelte";
  import RadioGroup from "$lib/components/ui/radio-group-field";
  import SettingsSectionCard from "../SettingsSectionCard.svelte";
  import { themeItems } from "../options";

  type Props = {
    settingsDraft: Settings;
    onThemeChange?: (theme: ThemePreference) => void;
    onSettingsChange?: (patch: UpdateSettingsRequest, options?: { immediate?: boolean; debounceMs?: number }) => void;
  };

  let { settingsDraft, onThemeChange, onSettingsChange }: Props = $props();

  function setThemePreference(value: string) {
    const preference = value as ThemePreference;
    settingsDraft.ui.theme = preference;
    onThemeChange?.(preference);
    onSettingsChange?.({ ui: { theme: preference } }, { immediate: true });
  }
</script>

<SettingsSectionCard section="appearance" title="Appearance">
    <div class="settings-row settings-row-stacked">
      <div class="settings-copy">
        <strong>Color theme</strong>
      </div>
      <RadioGroup
        items={themeItems}
        value={settingsDraft.ui.theme}
        orientation="horizontal"
        ariaLabel="Theme preference"
        onValueChange={setThemePreference}
      />
    </div>
</SettingsSectionCard>

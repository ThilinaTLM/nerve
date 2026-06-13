<script lang="ts">
  import Monitor from "@lucide/svelte/icons/monitor";
  import type { Settings, UpdateSettingsRequest } from "$lib/api";
  import type { ThemePreference } from "$lib/state/app-state.svelte";
  import RadioGroup from "$lib/components/ui/radio-group-field";
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

<section id="settings-appearance" class="settings-section" data-section="appearance">
  <header class="settings-section-header">
    <div class="settings-section-kicker"><Monitor size={14} strokeWidth={2.1} /> Appearance</div>
    <h2>Theme</h2>
    <p>Choose how Nerve renders the workbench. Theme changes apply immediately.</p>
  </header>
  <div class="settings-section-body">
    <div class="settings-row settings-row-stacked">
      <div class="settings-copy">
        <strong>Color theme</strong>
        <span>Dark is the primary theme; light remains a compatibility fallback.</span>
      </div>
      <RadioGroup
        items={themeItems}
        value={settingsDraft.ui.theme}
        orientation="horizontal"
        ariaLabel="Theme preference"
        onValueChange={setThemePreference}
      />
    </div>
  </div>
</section>

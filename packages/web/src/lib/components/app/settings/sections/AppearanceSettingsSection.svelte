<script lang="ts">
  import Monitor from "@lucide/svelte/icons/monitor";
  import type { Settings } from "../../../../api";
  import type { ThemePreference } from "../../../../state/app-state.svelte";
  import RadioGroup from "$lib/components/ui/radio-group-field";
  import { themeItems } from "../options";

  type Props = {
    settingsDraft: Settings;
    onThemeChange?: (theme: ThemePreference) => void;
  };

  let { settingsDraft, onThemeChange }: Props = $props();

  function setThemePreference(value: string) {
    const preference = value as ThemePreference;
    settingsDraft.ui.theme = preference;
    onThemeChange?.(preference);
  }
</script>

<section class="settings-card app-card" data-section="appearance">
  <div class="card-head">
    <div class="card-icon"><Monitor size={16} strokeWidth={2.2} /></div>
    <div>
      <span class="eyebrow">Appearance</span>
      <h2>Theme</h2>
      <p>Dark mode follows the Stitch Technical Precision reference. Light remains as a compatibility fallback.</p>
    </div>
  </div>
  <RadioGroup
    items={themeItems}
    value={settingsDraft.ui.theme}
    orientation="horizontal"
    ariaLabel="Theme preference"
    onValueChange={setThemePreference}
  />
</section>

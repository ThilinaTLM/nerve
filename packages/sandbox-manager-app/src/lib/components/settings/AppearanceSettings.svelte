<script lang="ts">
import { SettingsSectionCard } from "@nervekit/workbench-ui/components/settings";
import RadioGroup from "@nervekit/workbench-ui/components/ui/radio-group-field";
import {
  useAppearance,
  type ThemePreference,
} from "../../state/appearance.svelte";

const appearance = useAppearance();

const options: { value: ThemePreference; label: string; detail: string }[] = [
  { value: "system", label: "System", detail: "Follow the operating system" },
  { value: "dark", label: "Dark", detail: "Dark sandbox surfaces" },
  { value: "light", label: "Light", detail: "Light sandbox surfaces" },
];

function setThemePreference(value: string): void {
  appearance.setPreference(value as ThemePreference);
}
</script>

<SettingsSectionCard
  section="appearance"
  title="Appearance"
  description="Choose how the sandbox manager looks on this device."
>
  <div class="settings-row settings-row-stacked">
    <div class="settings-copy">
      <strong>Color theme</strong>
    </div>
    <RadioGroup
      items={options}
      value={appearance.preference}
      orientation="horizontal"
      ariaLabel="Theme preference"
      onValueChange={setThemePreference}
    />
  </div>
</SettingsSectionCard>

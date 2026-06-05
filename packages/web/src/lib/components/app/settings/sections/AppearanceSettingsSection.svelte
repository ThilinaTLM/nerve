<script lang="ts">
  import Monitor from "@lucide/svelte/icons/monitor";
  import type { Settings } from "../../../../api";
  import type { ThemePreference } from "../../../../state/app-state.svelte";
  import RadioGroup from "$lib/components/ui/radio-group-field";
  import * as Card from "$lib/components/ui/card";
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

<Card.Root size="sm" data-section="appearance">
  <Card.Header>
    <Card.Title class="flex items-center gap-2">
      <Monitor size={16} strokeWidth={2.2} /> Theme
    </Card.Title>
    <Card.Description>Dark mode follows the Stitch Technical Precision reference. Light remains as a compatibility fallback.</Card.Description>
  </Card.Header>
  <Card.Content>
    <RadioGroup
      items={themeItems}
      value={settingsDraft.ui.theme}
      orientation="horizontal"
      ariaLabel="Theme preference"
      onValueChange={setThemePreference}
    />
  </Card.Content>
</Card.Root>

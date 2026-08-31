<script lang="ts">
import Monitor from "@lucide/svelte/icons/monitor";
import Moon from "@lucide/svelte/icons/moon";
import Sun from "@lucide/svelte/icons/sun";
import type { ColorTheme } from "$lib/api";
import {
  SettingsPreviewCards,
  type SettingsPreviewOption,
} from "$lib/presentation/settings";

const options: SettingsPreviewOption[] = [
  {
    value: "system",
    label: "System",
    icon: Monitor,
    previews: ["light", "dark"],
  },
  { value: "light", label: "Light", icon: Sun, previews: ["light"] },
  { value: "dark", label: "Dark", icon: Moon, previews: ["dark"] },
];

let {
  value = $bindable(""),
  theme,
  ariaLabel = "Color mode",
  class: className,
  onValueChange,
}: {
  value?: string;
  theme: ColorTheme;
  ariaLabel?: string;
  class?: string;
  onValueChange?: (value: string) => void;
} = $props();
</script>

<SettingsPreviewCards
  {options}
  bind:value
  {ariaLabel}
  class={className}
  {onValueChange}
  previewAttrs={(option, mode) => ({
    "data-theme-preview": theme,
    "data-color-mode": mode,
  })}
/>

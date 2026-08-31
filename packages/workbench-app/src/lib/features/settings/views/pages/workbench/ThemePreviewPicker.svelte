<script lang="ts">
import Palette from "@lucide/svelte/icons/palette";
import TreePine from "@lucide/svelte/icons/tree-pine";
import Waves from "@lucide/svelte/icons/waves";
import {
  SettingsPreviewCards,
  type SettingsPreviewOption,
} from "$lib/presentation/settings";

const options: SettingsPreviewOption[] = [
  { value: "nerve", label: "Nerve", icon: Palette },
  { value: "ocean", label: "Ocean", icon: Waves },
  { value: "forest", label: "Forest", icon: TreePine },
];

let {
  value = $bindable(""),
  ariaLabel = "Theme",
  class: className,
  onValueChange,
}: {
  value?: string;
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
  previewForegroundClass="bg-primary"
  previewAttrs={(option, mode) => ({
    "data-theme-preview": option.value,
    "data-color-mode": mode,
  })}
/>

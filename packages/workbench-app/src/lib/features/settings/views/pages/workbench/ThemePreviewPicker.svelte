<script lang="ts">
import Droplets from "@lucide/svelte/icons/droplets";
import Leaf from "@lucide/svelte/icons/leaf";
import Moon from "@lucide/svelte/icons/moon";
import Palette from "@lucide/svelte/icons/palette";
import {
  SettingsPreviewCards,
  type SettingsPreviewOption,
} from "$lib/presentation/settings";

const options: SettingsPreviewOption[] = [
  { value: "nerve", label: "Nerve", icon: Palette },
  { value: "ocean", label: "Ocean", icon: Droplets },
  { value: "forest", label: "Forest", icon: Leaf },
  { value: "midnight", label: "Midnight", icon: Moon },
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

<!-- A theme now carries corner radius and elevation as well as color, so the
     swatch renders a miniature chrome instead of flat bars. -->
{#snippet themePreview()}
  <span class="w-1.5 flex-none rounded-sm bg-panel"></span>
  <span class="grid min-w-0 flex-1 content-start gap-1">
    <span class="grid gap-1 rounded-lg bg-card p-1 shadow-sm">
      <span class="h-1 w-full rounded-full bg-foreground/30"></span>
      <span class="h-1 w-2/3 rounded-full bg-foreground/20"></span>
    </span>
    <span class="h-2 w-2/3 rounded-md bg-primary"></span>
  </span>
{/snippet}

<SettingsPreviewCards
  {options}
  bind:value
  {ariaLabel}
  class={className}
  {onValueChange}
  previewBody={themePreview}
  previewAttrs={(option, mode) => ({
    "data-theme-preview": option.value,
    "data-color-mode": mode,
  })}
/>

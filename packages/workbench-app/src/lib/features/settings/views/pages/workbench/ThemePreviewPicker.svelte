<script lang="ts">
import Coffee from "@lucide/svelte/icons/coffee";
import Flame from "@lucide/svelte/icons/flame";
import Layers from "@lucide/svelte/icons/layers";
import {
  colorThemeKind,
  colorThemeSchema,
  type ColorTheme,
} from "@nervekit/contracts/settings";
import {
  SettingsPreviewCards,
  type SettingsPreviewOption,
} from "$lib/presentation/settings";

const themeOptions: Record<ColorTheme, Omit<SettingsPreviewOption, "value">> = {
  "nerve-light": {
    label: "Nerve Light",
    description: "Warm paper with an ember accent",
    icon: Flame,
  },
  "nerve-dark": {
    label: "Nerve Dark",
    description: "Warm umber with an ember accent",
    icon: Flame,
  },
  "melange-light": {
    label: "Melange Light",
    description: "Warm paper with soft orange and pastels",
    icon: Coffee,
  },
  "melange-dark": {
    label: "Melange Dark",
    description: "Warm cocoa with soft orange and pastels",
    icon: Coffee,
  },
  graphite: {
    label: "Graphite",
    description: "Neutral near-black with an ember accent",
    icon: Layers,
  },
};

// Family order (Nerve, Melange, Graphite), as in `colorThemeSchema`.
const options = colorThemeSchema.options.map((theme) => ({
  ...themeOptions[theme],
  value: theme,
}));

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

<!-- A theme carries colour only; the swatch renders a miniature chrome so the
     surface ladder and accent are visible. -->
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
  previewAttrs={(option) => ({
    "data-theme-preview": option.value,
    "data-color-mode": colorThemeKind[option.value as ColorTheme],
  })}
/>

<script lang="ts">
import type { Component } from "svelte";
import Monitor from "@lucide/svelte/icons/monitor";
import Moon from "@lucide/svelte/icons/moon";
import Sun from "@lucide/svelte/icons/sun";
import type { ColorTheme } from "$lib/api";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import * as RadioGroup from "@nervekit/ui-kit/components/ui/radio-group";
import { cn } from "@nervekit/ui-kit/core/utils";

type ModePreview = "light" | "dark";
type ModeOption = {
  value: string;
  label: string;
  icon: Component<{ class?: string; "aria-hidden"?: "true" }>;
  previews: ModePreview[];
};

const options: ModeOption[] = [
  {
    value: "system",
    label: "System",
    icon: Monitor,
    previews: ["light", "dark"],
  },
  { value: "light", label: "Light", icon: Sun, previews: ["light"] },
  { value: "dark", label: "Dark", icon: Moon, previews: ["dark"] },
];

type Props = {
  value?: string;
  theme: ColorTheme;
  ariaLabel?: string;
  class?: string;
  onValueChange?: (value: string) => void;
};

let {
  value = $bindable(""),
  theme,
  ariaLabel = "Color mode",
  class: className,
  onValueChange,
}: Props = $props();
</script>

<RadioGroup.Root
  bind:value
  aria-label={ariaLabel}
  {onValueChange}
  class={cn("flex flex-wrap gap-2", className)}
>
  {#each options as option (option.value)}
    {@const Icon = option.icon}
    <Label
      class="group/mode grid w-30 cursor-pointer gap-1.5 rounded-md border border-border/60 p-1.5 transition-colors hover:bg-accent/40 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/10"
    >
      <span
        class="flex h-12 overflow-hidden rounded-sm border border-border/60"
        aria-hidden="true"
      >
        {#each option.previews as mode, index (mode)}
          <span
            data-theme-preview={theme}
            data-color-mode={mode}
            class={cn(
              "flex min-w-0 flex-1 gap-1 bg-background p-1",
              index === 1 && "border-l border-border/40",
            )}
          >
            <span class="w-1.5 flex-none rounded-xs bg-sidebar"></span>
            <span class="grid min-w-0 flex-1 content-start gap-1">
              <span class="h-1 w-full rounded-full bg-foreground/30"></span>
              <span class="h-1 w-2/3 rounded-full bg-foreground/30"></span>
            </span>
          </span>
        {/each}
      </span>

      <span class="flex min-w-0 items-center gap-1.5">
        <RadioGroup.Item value={option.value} class="size-3.5" />
        <Icon
          class="size-3.5 flex-none text-muted-foreground group-has-data-[state=checked]/mode:text-primary"
          aria-hidden="true"
        />
        <span class="truncate text-xs font-medium">{option.label}</span>
      </span>
    </Label>
  {/each}
</RadioGroup.Root>

<script lang="ts">
import type { Component } from "svelte";
import Monitor from "@lucide/svelte/icons/monitor";
import Moon from "@lucide/svelte/icons/moon";
import Sun from "@lucide/svelte/icons/sun";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import * as RadioGroup from "@nervekit/ui-kit/components/ui/radio-group";
import { cn } from "@nervekit/ui-kit/core/utils";

/**
 * Theme tokens flip with the active theme, so a preview that must always look
 * light (or always dark) pairs a token with its `dark:` counterpart.
 */
const lightSurface = "bg-background dark:bg-foreground";
const lightSidebar = "bg-foreground/10 dark:bg-background/20";
const lightLine = "bg-foreground/30 dark:bg-background/45";

const darkSurface = "bg-foreground dark:bg-background";
const darkSidebar = "bg-background/20 dark:bg-foreground/10";
const darkLine = "bg-background/45 dark:bg-foreground/30";

type ThemeOption = {
  value: string;
  label: string;
  icon: Component<{ class?: string; "aria-hidden"?: "true" }>;
  /** Left preview half; the right half is used for the split System preview. */
  left: { surface: string; sidebar: string; line: string };
  right?: { surface: string; sidebar: string; line: string };
};

const light = { surface: lightSurface, sidebar: lightSidebar, line: lightLine };
const dark = { surface: darkSurface, sidebar: darkSidebar, line: darkLine };

const options: ThemeOption[] = [
  { value: "system", label: "System", icon: Monitor, left: light, right: dark },
  { value: "dark", label: "Dark", icon: Moon, left: dark },
  { value: "light", label: "Light", icon: Sun, left: light },
];

type Props = {
  value?: string;
  ariaLabel?: string;
  class?: string;
  onValueChange?: (value: string) => void;
};

let {
  value = $bindable(""),
  ariaLabel = "Color theme",
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
      class="group/theme grid w-30 cursor-pointer gap-1.5 rounded-md border border-border/60 p-1.5 transition-colors hover:bg-accent/40 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/10"
    >
      <span
        class="flex h-12 overflow-hidden rounded-sm border border-border/60"
        aria-hidden="true"
      >
        {#each [option.left, option.right].filter(Boolean) as half, index (index)}
          <span
            class={cn(
              "flex min-w-0 flex-1 gap-1 p-1",
              half?.surface,
              index === 1 && "border-l border-border/40",
            )}
          >
            <span class={cn("w-1.5 flex-none rounded-xs", half?.sidebar)}
            ></span>
            <span class="grid min-w-0 flex-1 content-start gap-1">
              <span class={cn("h-1 w-full rounded-full", half?.line)}></span>
              <span class={cn("h-1 w-2/3 rounded-full", half?.line)}></span>
            </span>
          </span>
        {/each}
      </span>

      <span class="flex min-w-0 items-center gap-1.5">
        <RadioGroup.Item value={option.value} class="size-3.5" />
        <Icon
          class="size-3.5 flex-none text-muted-foreground group-has-data-[state=checked]/theme:text-primary"
          aria-hidden="true"
        />
        <span class="truncate text-xs font-medium">{option.label}</span>
      </span>
    </Label>
  {/each}
</RadioGroup.Root>

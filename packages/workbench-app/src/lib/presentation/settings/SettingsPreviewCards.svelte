<script lang="ts">
import type { Component } from "svelte";
import Check from "@lucide/svelte/icons/check";
import { cn } from "@nervekit/ui-kit/utils";

type PreviewMode = "light" | "dark";

const ALL_PREVIEW_MODES: PreviewMode[] = ["light", "dark"];

export type SettingsPreviewOption = {
  value: string;
  label: string;
  icon: Component<{ class?: string; "aria-hidden"?: "true" }>;
  /** Which color modes this option previews; defaults to both light + dark. */
  previews?: PreviewMode[];
};

let {
  options,
  value = $bindable(""),
  ariaLabel,
  previewForegroundClass = "bg-foreground/30",
  previewAttrs,
  class: className,
  onValueChange,
}: {
  options: SettingsPreviewOption[];
  value?: string;
  ariaLabel: string;
  /** Class for the emphasized preview bar (e.g. "bg-foreground/30" or "bg-primary"). */
  previewForegroundClass?: string;
  /**
   * Data attributes (data-theme-preview / data-color-mode) placed on each
   * preview strip; these drive the theme swatch colors via theme.css.
   */
  previewAttrs?: (
    option: SettingsPreviewOption,
    mode: PreviewMode,
  ) => Record<string, string>;
  class?: string;
  onValueChange?: (value: string) => void;
} = $props();

function choose(next: string): void {
  value = next;
  onValueChange?.(next);
}
</script>

<div
  class={cn("flex flex-wrap gap-2", className)}
  role="radiogroup"
  aria-label={ariaLabel}
>
  {#each options as option (option.value)}
    {@const active = value === option.value}
    {@const Icon = option.icon}
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={option.label}
      class={cn(
        "group/opt grid min-w-0 cursor-pointer gap-1.5 rounded-md border bg-accent/90 p-1.5 text-left transition-colors hover:bg-accent/95 dark:bg-accent/60 dark:hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active ? "border-primary" : "border-transparent",
      )}
      onclick={() => choose(option.value)}
    >
      <span
        class="flex h-12 overflow-hidden rounded-sm border border-border/60"
        aria-hidden="true"
      >
        {#each option.previews ?? ALL_PREVIEW_MODES as mode, index (mode)}
          {@const attrs = previewAttrs?.(option, mode) ?? {}}
          <span
            {...attrs}
            class={cn(
              "flex min-w-0 flex-1 gap-1 bg-background p-1",
              index === 1 && "border-l border-border/40",
            )}
          >
            <span class="w-1.5 flex-none rounded-xs bg-sidebar"></span>
            <span class="grid min-w-0 flex-1 content-start gap-1">
              <span
                class={cn("h-1 w-full rounded-full", previewForegroundClass)}
              ></span>
              <span class="h-1 w-2/3 rounded-full bg-foreground/30"></span>
            </span>
          </span>
        {/each}
      </span>

      <span class="flex min-w-0 items-center gap-1.5">
        {#if active}
          <Check class="size-3.5 flex-none text-primary" aria-hidden="true" />
        {:else}
          <span class="size-3.5 flex-none rounded-full border border-border/70"
          ></span>
        {/if}
        <Icon
          class="size-3.5 flex-none text-muted-foreground"
          aria-hidden="true"
        />
        <span class="truncate text-xs font-medium">{option.label}</span>
      </span>
    </button>
  {/each}
</div>

<script lang="ts">
import type { Component, Snippet } from "svelte";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import { cn } from "@nervekit/ui-kit/utils";

export type SettingsPreviewOption = {
  value: string;
  label: string;
  /** Short hint shown as a tooltip. */
  description?: string;
  icon: Component<{ class?: string; "aria-hidden"?: "true" }>;
};

let {
  options,
  value = $bindable(""),
  ariaLabel,
  previewBody,
  previewAttrs,
  class: className,
  onValueChange,
}: {
  options: SettingsPreviewOption[];
  value?: string;
  ariaLabel: string;
  /**
   * Replaces the default two-bar swatch content. Themes use this to show
   * their surface ladder and accent, which plain color bars cannot express.
   */
  previewBody?: Snippet;
  /**
   * Data attributes (data-theme-preview / data-color-mode) placed on each
   * preview strip; these drive the swatch colors via theme.css.
   */
  previewAttrs?: (option: SettingsPreviewOption) => Record<string, string>;
  class?: string;
  onValueChange?: (value: string) => void;
} = $props();

const buttons: HTMLButtonElement[] = $state([]);
const activeIndex = $derived(
  options.findIndex((option) => option.value === value),
);

function choose(next: string): void {
  value = next;
  onValueChange?.(next);
}

/** Radio-group keyboard model: arrows move and select, Home/End jump. */
function onKeydown(event: KeyboardEvent, index: number): void {
  const last = options.length - 1;
  const target =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? index === last
        ? 0
        : index + 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? index === 0
          ? last
          : index - 1
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? last
            : undefined;
  if (target === undefined) return;
  event.preventDefault();
  choose(options[target].value);
  buttons[target]?.focus();
}
</script>

<!-- Cards share one fixed width (fits the longest label with its radio and
     icon) so a wrapping row stays a tidy grid whatever the labels are. -->
<div
  class={cn("flex flex-wrap gap-2", className)}
  role="radiogroup"
  aria-label={ariaLabel}
>
  {#each options as option, index (option.value)}
    {@const active = value === option.value}
    {@const Icon = option.icon}
    <button
      bind:this={buttons[index]}
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={option.label}
      tabindex={active || (activeIndex < 0 && index === 0) ? 0 : -1}
      title={option.description}
      class={cn(
        "group/opt grid w-38 cursor-pointer gap-1.5 rounded-md border bg-card p-1.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus",
        active
          ? "border-primary bg-selected hover:bg-selected"
          : "border-transparent",
      )}
      onclick={() => choose(option.value)}
      onkeydown={(event) => onKeydown(event, index)}
    >
      <span
        class="flex h-12 overflow-hidden rounded-sm border border-border-subtle"
        aria-hidden="true"
      >
        <span
          {...previewAttrs?.(option) ?? {}}
          class="flex min-w-0 flex-1 gap-1 bg-background p-1"
        >
          {#if previewBody}
            {@render previewBody()}
          {:else}
            <span class="w-1.5 flex-none rounded-sm bg-panel"></span>
            <span class="grid min-w-0 flex-1 content-start gap-1">
              <span class="h-1 w-full rounded-full bg-foreground/30"></span>
              <span class="h-1 w-2/3 rounded-full bg-foreground/30"></span>
            </span>
          {/if}
        </span>
      </span>

      <span class="flex min-w-0 items-center gap-1.5">
        {#if active}
          <CircleCheck
            class="size-3.5 flex-none text-foreground"
            aria-hidden="true"
          />
        {:else}
          <span
            class="size-3.5 flex-none rounded-full border border-border-subtle"
          ></span>
        {/if}
        <Icon
          class="size-3.5 flex-none text-muted-foreground"
          aria-hidden="true"
        />
        <span class="truncate text-ui font-medium">{option.label}</span>
      </span>
    </button>
  {/each}
</div>

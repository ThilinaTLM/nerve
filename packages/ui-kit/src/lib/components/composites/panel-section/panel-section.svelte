<script lang="ts">
import type { Component, Snippet } from "svelte";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import { cn } from "@nervekit/ui-kit/utils";

let {
  open = $bindable(true),
  title,
  label,
  icon: Icon,
  count,
  meta,
  actions,
  children,
  keepMounted = false,
  onOpenChange,
  class: className,
  headerClass,
  bodyClass,
}: {
  /** Whether the body is shown. The header line stays visible when closed. */
  open?: boolean;
  /** Plain-text heading. Ignored when `label` is given. */
  title?: string;
  /** Custom heading content inside the toggle button; replaces `title`, `icon` and `count`. */
  label?: Snippet;
  /** Icon before the title. */
  icon?: Component<{ class?: string; "aria-hidden"?: "true" }>;
  /** Count after the title. */
  count?: number | string;
  /** Muted trailing text inside the toggle button, right-aligned (e.g. "2 staged"). */
  meta?: Snippet;
  /** Controls after the toggle button; they stay clickable and do not toggle the section. */
  actions?: Snippet;
  /** Section body. */
  children?: Snippet;
  /** Keep the body mounted (inert) while closed, preserving its state; a parent then owns hiding it. */
  keepMounted?: boolean;
  /** Called after the user toggles the section. */
  onOpenChange?: (open: boolean) => void;
  class?: string;
  headerClass?: string;
  bodyClass?: string;
} = $props();

function toggle(): void {
  open = !open;
  onOpenChange?.(open);
}
</script>

<div class={cn("flex flex-col text-ui", className)}>
  <div class={cn("flex h-8 shrink-0 items-center gap-1", headerClass)}>
    <button
      type="button"
      class="group/section flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 self-stretch rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-focus"
      aria-expanded={open}
      onclick={toggle}
    >
      {#if open}
        <ChevronDown
          class="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover/section:text-foreground"
        />
      {:else}
        <ChevronRight
          class="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover/section:text-foreground"
        />
      {/if}
      {#if label}
        {@render label()}
      {:else}
        {#if Icon}
          <Icon
            class="size-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        {/if}
        <span class="truncate font-medium">{title}</span>
        {#if count !== undefined}
          <span class="shrink-0 text-muted-foreground tabular-nums"
            >{count}</span
          >
        {/if}
      {/if}
      {#if meta}
        <span class="ml-auto shrink-0 pr-1 text-caption text-muted-foreground"
          >{@render meta()}</span
        >
      {/if}
    </button>
    {@render actions?.()}
  </div>
  {#if children && (open || keepMounted)}
    <div class={bodyClass} inert={!open}>
      {@render children()}
    </div>
  {/if}
</div>

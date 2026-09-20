<script lang="ts">
import type { Snippet } from "svelte";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronLeft from "@lucide/svelte/icons/chevron-left";
import { Button } from "@nervekit/ui-kit/components/ui/button";

/**
 * One phone screen: a sticky title row and a scrolling body. Every mobile
 * destination uses it so headers, back affordance, and safe-area handling stay
 * identical across the shell.
 */
let {
  title,
  subtitle,
  onBack,
  backLabel = "Back",
  onTitleSelect,
  titleLabel,
  scroll = true,
  leading,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  /** Makes the title a button, e.g. to open the project picker page. */
  onTitleSelect?: () => void;
  titleLabel?: string;
  /** Disable for screens that own their own scroll container. */
  scroll?: boolean;
  leading?: Snippet;
  actions?: Snippet;
  children: Snippet;
} = $props();
</script>

<section class="mobile-screen">
  <header class="mobile-screen-header">
    {#if onBack}
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel={backLabel}
        onclick={onBack}
      >
        <ChevronLeft size={20} strokeWidth={2.1} />
      </Button>
    {:else if leading}
      {@render leading()}
    {/if}
    {#if onTitleSelect}
      <button
        type="button"
        class="mobile-screen-title"
        aria-label={titleLabel ?? title}
        onclick={onTitleSelect}
      >
        <span class="grid min-w-0 flex-1 text-left">
          <span class="flex min-w-0 items-center gap-1">
            <span class="truncate text-sm font-semibold text-foreground"
              >{title}</span
            >
            <ChevronDown
              class="flex-none text-muted-foreground"
              size={15}
              strokeWidth={2.1}
            />
          </span>
          {#if subtitle}
            <span class="truncate text-xs text-muted-foreground"
              >{subtitle}</span
            >
          {/if}
        </span>
      </button>
    {:else}
      <span class="grid min-w-0 flex-1">
        <span class="truncate text-sm font-semibold text-foreground"
          >{title}</span
        >
        {#if subtitle}
          <span class="truncate text-xs text-muted-foreground">{subtitle}</span>
        {/if}
      </span>
    {/if}
    {#if actions}
      <span class="flex flex-none items-center gap-1">{@render actions()}</span>
    {/if}
  </header>
  <div class={scroll ? "mobile-screen-body scroll" : "mobile-screen-body"}>
    {@render children()}
  </div>
</section>

<style>
.mobile-screen {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--background);
}

.mobile-screen-header {
  display: flex;
  flex: none;
  align-items: center;
  gap: 0.5rem;
  min-height: 3rem;
  padding: 0.5rem 0.75rem;
  padding-top: calc(0.5rem + env(safe-area-inset-top));
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.mobile-screen-title {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
  min-height: 2.25rem;
  padding-right: 0.25rem;
  border-radius: var(--radius-md);
}

.mobile-screen-title:active {
  background: var(--accent);
}

.mobile-screen-body {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}

/* Scrolling screens stack their sections; embedded panels own their own
 * scroller and get a single full-height row instead. */
.mobile-screen-body.scroll {
  display: block;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: 0.75rem;
}
</style>

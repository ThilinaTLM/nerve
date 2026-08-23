<script lang="ts">
import ChevronLeft from "@lucide/svelte/icons/chevron-left";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import { onMount } from "svelte";
import { fade } from "svelte/transition";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { DiscoverEditorialAction } from "../discover-catalog.js";
import type { ResolvedDiscoverHighlight } from "../discover-policy.js";
import DiscoverNewsArtwork from "./DiscoverNewsArtwork.svelte";

type Props = {
  items: ResolvedDiscoverHighlight[];
  onEditorialAction: (action: DiscoverEditorialAction) => void;
};

let { items, onEditorialAction }: Props = $props();

let index = $state(0);
let paused = $state(false);
let reducedMotion = $state(false);
const activeItem = $derived(items[index] ?? items[0]);

function move(direction: -1 | 1): void {
  if (items.length < 2) return;
  index = (index + direction + items.length) % items.length;
}

function handleFocusOut(event: FocusEvent): void {
  const current = event.currentTarget as HTMLElement;
  const next = event.relatedTarget;
  if (!(next instanceof Node) || !current.contains(next)) paused = false;
}

$effect(() => {
  if (index >= items.length) index = 0;
});

onMount(() => {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const updateMotionPreference = () => (reducedMotion = media.matches);
  updateMotionPreference();
  media.addEventListener("change", updateMotionPreference);
  const timer = window.setInterval(() => {
    if (!paused && !reducedMotion && items.length > 1) move(1);
  }, 7_000);
  return () => {
    window.clearInterval(timer);
    media.removeEventListener("change", updateMotionPreference);
  };
});
</script>

{#if activeItem}
  <section
    class="group/news relative overflow-hidden rounded-md border bg-card"
    aria-label="News"
    aria-roledescription="carousel"
    onmouseenter={() => (paused = true)}
    onmouseleave={() => (paused = false)}
    onfocusin={() => (paused = true)}
    onfocusout={handleFocusOut}
  >
    {#if items.length > 1}
      <div
        class="pointer-events-none absolute right-2.5 top-2.5 z-20 flex items-center gap-0.5 rounded-md bg-background/85 p-0.5 opacity-0 shadow-xs transition-opacity group-focus-within/news:pointer-events-auto group-focus-within/news:opacity-100 group-hover/news:pointer-events-auto group-hover/news:opacity-100 max-sm:pointer-events-auto max-sm:opacity-100"
      >
        <Button
          variant="ghost"
          size="icon-xs"
          ariaLabel="Previous news item"
          onclick={() => move(-1)}
        >
          <ChevronLeft class="size-3.5" aria-hidden="true" />
        </Button>
        <span class="min-w-8 text-center text-xs text-muted-foreground">
          {index + 1}/{items.length}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          ariaLabel="Next news item"
          onclick={() => move(1)}
        >
          <ChevronRight class="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    {/if}

    {#key activeItem.id}
      <div
        class="grid min-h-36 sm:grid-cols-[minmax(0,1fr)_15rem]"
        in:fade={{ duration: reducedMotion ? 0 : 170 }}
      >
        <div
          class="relative z-10 flex min-w-0 flex-col justify-center gap-2.5 px-4 py-4 pr-20 sm:pl-5"
          role="group"
          aria-label={`${index + 1} of ${items.length}`}
          aria-live="off"
        >
          <div class="grid gap-1">
            <h2 class="text-base font-semibold leading-tight">
              {activeItem.title}
            </h2>
            <p
              class="line-clamp-2 text-xs leading-relaxed text-muted-foreground"
            >
              {activeItem.description}
            </p>
          </div>
          <div class="flex min-h-5 flex-wrap items-center gap-1.5">
            {#if activeItem.releaseLabel}
              <Badge variant="outline" size="xs">
                {activeItem.releaseLabel}
              </Badge>
            {/if}
            {#if activeItem.new}
              <Badge tone="running" size="xs">New</Badge>
            {/if}
          </div>
          {#if activeItem.action}
            <div>
              <Button
                variant="outline"
                size="xs"
                onclick={() => onEditorialAction(activeItem.action!)}
              >
                {activeItem.action.label}
              </Button>
            </div>
          {/if}
        </div>
        <div class="hidden min-h-36 p-2 sm:block">
          <DiscoverNewsArtwork artwork={activeItem.artwork} />
        </div>
      </div>
    {/key}
  </section>
{/if}

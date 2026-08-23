<script lang="ts">
import CircleCheck from "@lucide/svelte/icons/circle-check";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import type { DiscoverEditorialAction } from "../catalog.js";
import type { GuideId } from "../guides/catalog.js";
import type { DiscoverSections } from "../policy.js";
import DiscoverCard from "./DiscoverCard.svelte";
import DiscoverNewsCarousel from "./DiscoverNewsCarousel.svelte";

type Props = {
  sections: DiscoverSections;
  workbenchBlocked: boolean;
  onStartGuide: (id: GuideId) => void;
  onMarkCompleted: (id: GuideId) => void;
  onEditorialAction: (action: DiscoverEditorialAction) => void;
};

let {
  sections,
  workbenchBlocked,
  onStartGuide,
  onMarkCompleted,
  onEditorialAction,
}: Props = $props();
</script>

<div class="h-full min-h-0 overflow-y-auto bg-background">
  <main class="mx-auto grid w-full max-w-5xl gap-5 px-4 py-5 sm:px-6 sm:py-6">
    {#if sections.highlights.length > 0}
      <DiscoverNewsCarousel items={sections.highlights} {onEditorialAction} />
    {/if}

    {#if sections.startHere.length > 0}
      <section class="grid gap-2.5" aria-labelledby="discover-start-title">
        <div class="flex items-center justify-between gap-3">
          <div class="grid gap-0.5">
            <h2 id="discover-start-title" class="text-sm font-semibold">
              Recommended next
            </h2>
            <p class="text-xs text-muted-foreground">
              Based on the setup and walkthroughs you have not completed yet.
            </p>
          </div>
          <Badge tone="warn" size="xs">
            {sections.startHere.length} remaining
          </Badge>
        </div>
        <div class="grid gap-2.5 lg:grid-cols-2">
          {#each sections.startHere as guide (guide.id)}
            <DiscoverCard
              {guide}
              {workbenchBlocked}
              {onStartGuide}
              {onMarkCompleted}
              {onEditorialAction}
            />
          {/each}
        </div>
      </section>
    {/if}

    {#if sections.tips.length > 0}
      <section class="grid gap-2.5" aria-labelledby="discover-tips-title">
        <div class="flex items-center gap-1.5">
          <Lightbulb class="size-3.5 text-warning" aria-hidden="true" />
          <div class="grid gap-0.5">
            <h2 id="discover-tips-title" class="text-sm font-semibold">
              Tips & tricks
            </h2>
            <p class="text-xs text-muted-foreground">
              Small adjustments that can make everyday work more efficient.
            </p>
          </div>
        </div>
        <div class="grid gap-2.5 lg:grid-cols-2">
          {#each sections.tips as editorial (editorial.id)}
            <DiscoverCard
              {editorial}
              {onStartGuide}
              {onMarkCompleted}
              {onEditorialAction}
            />
          {/each}
        </div>
      </section>
    {/if}

    {#if sections.completed.length > 0}
      <section class="grid gap-2" aria-labelledby="discover-completed-title">
        <div class="flex items-center gap-1.5 text-muted-foreground">
          <CircleCheck class="size-3.5" aria-hidden="true" />
          <h2 id="discover-completed-title" class="text-xs font-medium">
            Completed guides
          </h2>
        </div>
        <div class="grid gap-2 lg:grid-cols-2">
          {#each sections.completed as guide (guide.id)}
            <DiscoverCard
              {guide}
              subdued
              {workbenchBlocked}
              {onStartGuide}
              {onMarkCompleted}
              {onEditorialAction}
            />
          {/each}
        </div>
      </section>
    {/if}
  </main>
</div>

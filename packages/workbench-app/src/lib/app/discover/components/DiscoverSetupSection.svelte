<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import type { GuideId } from "../guides/catalog.js";
import type { DiscoverSetupSection } from "../policy.js";
import DiscoverList from "./DiscoverList.svelte";
import DiscoverListRow from "./DiscoverListRow.svelte";
import DiscoverSection from "./DiscoverSection.svelte";
import { guideIcons } from "./guide-icons.js";

type Props = {
  setup: DiscoverSetupSection;
  onStartGuide: (id: GuideId) => void;
  onMarkCompleted: (id: GuideId) => void;
};

let { setup, onStartGuide, onMarkCompleted }: Props = $props();

let completedOpen = $state(false);

const progress = $derived(
  setup.totalCount === 0
    ? 0
    : Math.round((setup.completedCount / setup.totalCount) * 100),
);
</script>

<DiscoverSection id="discover-setup-title" title="Set up Nerve">
  {#snippet trailing()}
    <span class="text-xs text-muted-foreground">
      {setup.completedCount} of {setup.totalCount} done
    </span>
    <Progress
      class="w-20"
      value={progress}
      aria-label={`${setup.completedCount} of ${setup.totalCount} setup guides complete`}
    />
  {/snippet}

  <DiscoverList>
    {#each setup.pending as guide (guide.id)}
      <DiscoverListRow
        icon={guideIcons[guide.id]}
        title={guide.title}
        description={guide.description}
      >
        {#snippet meta()}
          {#if guide.priority === "must-do"}
            <Badge variant="warning">Must do</Badge>
          {/if}
        {/snippet}
        {#snippet actions()}
          <Button size="xs" onclick={() => onStartGuide(guide.id)}>
            {guide.actionLabel ?? "Start"}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onclick={() => onMarkCompleted(guide.id)}
          >
            <Check class="size-3.5" aria-hidden="true" />
            Mark done
          </Button>
        {/snippet}
      </DiscoverListRow>
    {/each}

    {#if setup.pending.length === 0}
      <p
        class="flex items-center gap-1.5 px-3 py-2.5 text-xs text-muted-foreground"
      >
        <CircleCheck class="size-3.5 text-success" aria-hidden="true" />
        Setup is complete.
      </p>
    {/if}

    {#if setup.completed.length > 0}
      <div class="px-1 py-1">
        <Button
          variant="ghost"
          size="xs"
          onclick={() => (completedOpen = !completedOpen)}
          aria-expanded={completedOpen}
        >
          {#if completedOpen}
            <ChevronDown class="size-3.5" aria-hidden="true" />
          {:else}
            <ChevronRight class="size-3.5" aria-hidden="true" />
          {/if}
          {completedOpen
            ? "Hide completed"
            : `Show ${setup.completed.length} completed`}
        </Button>
      </div>
    {/if}

    {#if completedOpen}
      {#each setup.completed as guide (guide.id)}
        <DiscoverListRow
          icon={guideIcons[guide.id]}
          title={guide.title}
          subdued
        >
          {#snippet meta()}
            <CircleCheck class="size-3.5 text-success" aria-hidden="true" />
          {/snippet}
          {#snippet actions()}
            <Button
              variant="ghost"
              size="xs"
              onclick={() => onStartGuide(guide.id)}
            >
              Replay
            </Button>
          {/snippet}
        </DiscoverListRow>
      {/each}
    {/if}
  </DiscoverList>
</DiscoverSection>

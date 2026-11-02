<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import type { GuideId } from "../guides/catalog.js";
import type { ResolvedGuide } from "../guides/catalog-policy.js";
import type { DiscoverSetupSection } from "../policy.js";
import DiscoverList from "./DiscoverList.svelte";
import DiscoverListRow from "./DiscoverListRow.svelte";
import DiscoverSection from "./DiscoverSection.svelte";
import { guideIcons } from "./guide-icons.js";

type Props = {
  setup: DiscoverSetupSection;
  walkthroughs: ResolvedGuide[];
  workbenchBlocked: boolean;
  onStartGuide: (id: GuideId) => void;
  onMarkCompleted: (id: GuideId) => void;
};

let {
  setup,
  walkthroughs,
  workbenchBlocked,
  onStartGuide,
  onMarkCompleted,
}: Props = $props();

function blocked(guide: ResolvedGuide): boolean {
  return guide.run?.kind === "workbench-tour" && workbenchBlocked;
}

let completedOpen = $state(false);

const progress = $derived(
  setup.totalCount === 0
    ? 0
    : Math.round((setup.completedCount / setup.totalCount) * 100),
);
</script>

<DiscoverSection id="discover-setup-title" title="Get set up">
  {#snippet trailing()}
    <span class="text-ui text-muted-foreground">
      {setup.completedCount} of {setup.totalCount} done
    </span>
    <Progress
      class="w-20"
      value={progress}
      aria-label={`${setup.completedCount} of ${setup.totalCount} setup guides complete`}
    />
  {/snippet}

  <DiscoverList>
    {#each setup.pending as guide, index (guide.id)}
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
          <!-- Only the next guide is the view's primary action. -->
          <Button
            variant={index === 0 ? "default" : "outline"}
            size="sm"
            onclick={() => onStartGuide(guide.id)}
          >
            {guide.actionLabel ?? "Start"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
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
        class="flex items-center gap-1.5 px-3 py-2.5 text-ui text-muted-foreground"
      >
        <CircleCheck class="size-3.5 text-success" aria-hidden="true" />
        Setup is complete.
      </p>
    {/if}

    {#each walkthroughs as guide (guide.id)}
      <DiscoverListRow
        icon={guideIcons[guide.id]}
        title={guide.title}
        description={blocked(guide)
          ? "Open a project before starting this tour."
          : guide.description}
      >
        {#snippet meta()}
          {#if guide.completed}
            <CircleCheck class="size-3.5 text-success" aria-hidden="true" />
          {/if}
        {/snippet}
        {#snippet actions()}
          <Button
            variant={guide.completed ? "ghost" : "outline"}
            size="sm"
            onclick={() => onStartGuide(guide.id)}
          >
            {guide.completed ? "Replay" : (guide.actionLabel ?? "Start")}
          </Button>
        {/snippet}
      </DiscoverListRow>
    {/each}

    {#if setup.completed.length > 0}
      <div class="px-1 py-1">
        <Button
          variant="ghost"
          size="sm"
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
              size="sm"
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

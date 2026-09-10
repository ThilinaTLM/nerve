<script lang="ts">
import CircleCheck from "@lucide/svelte/icons/circle-check";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { GuideId } from "../guides/catalog.js";
import type { ResolvedGuide } from "../guides/catalog-policy.js";
import DiscoverList from "./DiscoverList.svelte";
import DiscoverListRow from "./DiscoverListRow.svelte";
import DiscoverSection from "./DiscoverSection.svelte";
import { guideIcons } from "./guide-icons.js";

type Props = {
  walkthroughs: ResolvedGuide[];
  workbenchBlocked: boolean;
  onStartGuide: (id: GuideId) => void;
};

let { walkthroughs, workbenchBlocked, onStartGuide }: Props = $props();

function blocked(guide: ResolvedGuide): boolean {
  return guide.run?.kind === "workbench-tour" && workbenchBlocked;
}
</script>

<DiscoverSection id="discover-walkthrough-title" title="Walkthroughs">
  <DiscoverList>
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
            size="xs"
            onclick={() => onStartGuide(guide.id)}
          >
            {guide.completed ? "Replay" : (guide.actionLabel ?? "Start")}
          </Button>
        {/snippet}
      </DiscoverListRow>
    {/each}
  </DiscoverList>
</DiscoverSection>

<script lang="ts">
import type { GitRepoSummary } from "@nervekit/contracts/git";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { ItemCollection, ItemSurface } from "$lib/presentation";
import { repoButtonLabel, repoPathLabel } from "./git-change-format";
import type { FeatureCapability } from "./git-panel-types";

type Props = {
  repos: GitRepoSummary[];
  selectedRepo: string;
  selectCapability: FeatureCapability;
  onSelectRepo: (value: string) => void;
};

let { repos, selectedRepo, selectCapability, onSelectRepo }: Props = $props();
</script>

{#if repos.length > 1}
  <ItemCollection
    activeKey={selectedRepo}
    class="flex w-full flex-wrap items-start gap-1"
  >
    {#each repos as candidate (candidate.relativePath)}
      {@const active = candidate.relativePath === selectedRepo}
      <ItemSurface
        itemKey={candidate.relativePath}
        hover="soft"
        class="min-w-0 max-w-28 overflow-hidden"
      >
        <Button
          variant="ghost"
          size="xs"
          disabled={!selectCapability.enabled}
          pressed={active}
          aria-current={active ? "page" : undefined}
          aria-label={`Switch to ${repoPathLabel(candidate)}`}
          title={repoPathLabel(candidate)}
          class={`w-full min-w-0 rounded-md bg-transparent px-2 hover:bg-transparent dark:hover:bg-transparent ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          onclick={() => onSelectRepo(candidate.relativePath)}
        >
          <span class="block truncate font-mono"
            >{repoButtonLabel(candidate, repos)}</span
          >
        </Button>
      </ItemSurface>
    {/each}
  </ItemCollection>
{/if}

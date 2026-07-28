<script lang="ts">
import type { GitRepoSummary } from "@nervekit/contracts";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@nervekit/ui-kit/components/ui/toggle-group";
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
  <ToggleGroup
    type="single"
    value={selectedRepo}
    variant="outline"
    size="sm"
    spacing={1}
    class="flex w-full flex-wrap items-start gap-1"
    onValueChange={(value) => {
      if (value) onSelectRepo(value);
    }}
  >
    {#each repos as candidate (candidate.relativePath)}
      <ToggleGroupItem
        value={candidate.relativePath}
        disabled={!selectCapability.enabled}
        aria-label={`Switch to ${repoPathLabel(candidate)}`}
        title={repoPathLabel(candidate)}
        class="h-6 max-w-28 min-w-0 rounded-md px-2 text-xs data-[state=on]:border-primary/40 data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
      >
        <span class="block truncate font-mono"
          >{repoButtonLabel(candidate, repos)}</span
        >
      </ToggleGroupItem>
    {/each}
  </ToggleGroup>
{/if}

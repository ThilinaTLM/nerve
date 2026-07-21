<script lang="ts">
import { untrack } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Checkbox } from "@nervekit/ui-kit/components/ui/checkbox";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import SelectField from "@nervekit/ui-kit/components/ui/select-field";
import {
  applyGitPrFilterDraft,
  createGitPrFilterDraft,
  defaultGitPrFilterConfig,
  gitPrFilterConfigsEqual,
} from "./git-panel-controller.js";
import type { GitPrFilterConfig } from "./git-panel-types.js";

type Props = {
  open?: boolean;
  filters: GitPrFilterConfig;
  hasCurrentBranch: boolean;
  onApply: (filters: GitPrFilterConfig) => void;
  onReset: () => void;
  onOpenChange?: (open: boolean) => void;
};

let {
  open = $bindable(false),
  filters,
  hasCurrentBranch,
  onApply,
  onReset,
  onOpenChange,
}: Props = $props();

let draft = $state(createGitPrFilterDraft(defaultGitPrFilterConfig));

const canApply = $derived(
  draft.author !== "username" || draft.username.trim().length > 0,
);
const canReset = $derived(
  !gitPrFilterConfigsEqual(filters, defaultGitPrFilterConfig),
);

$effect.pre(() => {
  if (!open) return;
  draft = untrack(() => createGitPrFilterDraft(filters));
});

function apply(): void {
  if (!canApply) return;
  onApply(applyGitPrFilterDraft(draft, hasCurrentBranch));
  open = false;
}
</script>

<Dialog
  bind:open
  title="Pull request filters"
  description="Choose which open GitHub pull requests appear. Up to 10 are shown."
  class="max-w-lg"
  {onOpenChange}
>
  <div class="grid gap-4 p-4">
    <div class="grid gap-1.5">
      <Label for="pr-filter-author">Author</Label>
      <SelectField
        bind:value={draft.author}
        ariaLabel="Pull request author"
        items={[
          { value: "any", label: "Any author" },
          { value: "me", label: "Me" },
          { value: "username", label: "GitHub username" },
        ]}
      />
    </div>

    {#if draft.author === "username"}
      <div class="grid gap-1.5">
        <Label for="pr-filter-username">GitHub username</Label>
        <Input
          id="pr-filter-username"
          bind:value={draft.username}
          placeholder="octocat"
          aria-invalid={draft.username.trim().length === 0}
        />
      </div>
    {/if}

    <div class="grid gap-1.5">
      <Label for="pr-filter-drafts">Drafts</Label>
      <SelectField
        bind:value={draft.drafts}
        ariaLabel="Draft pull requests"
        items={[
          { value: "include", label: "Include drafts" },
          { value: "exclude", label: "Exclude drafts" },
          { value: "only", label: "Drafts only" },
        ]}
      />
    </div>

    <div class="grid gap-1.5">
      <Label for="pr-filter-title">Title contains</Label>
      <Input
        id="pr-filter-title"
        bind:value={draft.title}
        placeholder="Search titles"
      />
    </div>

    <div class="grid gap-1.5">
      <Label for="pr-filter-labels">Labels</Label>
      <Input
        id="pr-filter-labels"
        bind:value={draft.labels}
        placeholder="bug, needs-review"
      />
      <p class="text-xs text-muted-foreground">
        Separate exact GitHub label names with commas.
      </p>
    </div>

    <div class="flex items-start gap-2">
      <Checkbox
        id="pr-filter-current-branch"
        bind:checked={draft.currentBranchOnly}
        disabled={!hasCurrentBranch}
      />
      <div class="grid gap-1">
        <Label for="pr-filter-current-branch">Current branch only</Label>
        {#if !hasCurrentBranch}
          <p class="text-xs text-muted-foreground">
            Unavailable while HEAD is detached.
          </p>
        {/if}
      </div>
    </div>

    <div class="grid gap-1.5">
      <Label for="pr-filter-sort">Sort by updated</Label>
      <SelectField
        bind:value={draft.sort}
        ariaLabel="Pull request sort order"
        items={[
          { value: "updated-desc", label: "Newest first" },
          { value: "updated-asc", label: "Oldest first" },
        ]}
      />
    </div>
  </div>

  {#snippet footer()}
    <Button
      variant="ghost"
      onclick={() => {
        onReset();
        open = false;
      }}
      disabled={!canReset}>Reset defaults</Button
    >
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button onclick={apply} disabled={!canApply}>Apply filters</Button>
  {/snippet}
</Dialog>

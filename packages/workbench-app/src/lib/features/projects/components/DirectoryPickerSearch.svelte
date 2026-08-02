<script lang="ts">
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import MoveUp from "@lucide/svelte/icons/move-up";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import SearchInput from "@nervekit/ui-kit/components/ui/search-input";
import Switch from "@nervekit/ui-kit/components/ui/switch-field";
import type { PathCrumb } from "$lib/core/utils/path";

type Props = {
  crumbs: PathCrumb[];
  loading: boolean;
  parent?: string;
  query: string;
  showHidden: boolean;
  onLoad?: (path?: string) => void;
  onReload?: () => void;
  onQueryChange?: (value: string) => void;
  onSubmit?: (event: Event) => void;
  onBack?: () => void;
};

let {
  crumbs,
  loading,
  parent,
  query = $bindable(),
  showHidden = $bindable(),
  onLoad,
  onReload,
  onQueryChange,
  onSubmit,
  onBack,
}: Props = $props();
</script>

<div
  class="flex items-center gap-2 border-b border-b-border/60 py-1.5 pr-2.5 pl-3"
>
  {#if onBack}
    <Button
      variant="ghost"
      size="icon-sm"
      title="Back to recents"
      ariaLabel="Back to recents"
      onclick={onBack}
    >
      <ArrowLeft size={15} strokeWidth={2.2} />
    </Button>
    <span class="h-4.5 w-px bg-border/70" aria-hidden="true"></span>
  {/if}
  <nav
    class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden font-mono text-xs"
    aria-label="Current location"
  >
    {#each crumbs as crumb, i (crumb.path)}
      {#if i > 0}<ChevronRight
          class="flex-none text-muted-foreground/55"
          size={13}
          strokeWidth={2.2}
          aria-hidden="true"
        />{/if}
      {#if i === crumbs.length - 1}
        <span
          class="max-w-48 cursor-default overflow-hidden px-1 py-0.5 font-medium text-ellipsis whitespace-nowrap text-foreground max-[560px]:max-w-28"
          title={crumb.path}>{crumb.label}</span
        >
      {:else}
        <button
          class="max-w-48 cursor-pointer overflow-hidden rounded-sm border-0 bg-transparent px-1 py-0.5 text-ellipsis whitespace-nowrap text-muted-foreground transition-[color,background-color,border-color,box-shadow] duration-120 not-disabled:hover:bg-accent not-disabled:hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none max-[560px]:max-w-28"
          type="button"
          title={crumb.path}
          disabled={loading}
          onclick={() => onLoad?.(crumb.path)}
        >
          {crumb.label}
        </button>
      {/if}
    {/each}
  </nav>
  <div class="flex flex-none items-center gap-1">
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={!parent || loading}
      title="Parent directory"
      ariaLabel="Parent directory"
      onclick={() => onLoad?.(parent)}
    >
      <MoveUp size={14} strokeWidth={2.2} />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={loading}
      title="Refresh"
      ariaLabel="Refresh"
      onclick={onReload}
    >
      <RefreshCw size={14} strokeWidth={2.2} />
    </Button>
    <span class="h-4.5 w-px bg-border/70" aria-hidden="true"></span>
    <Switch
      bind:checked={showHidden}
      label="Hidden"
      class="h-7 gap-1.5 rounded-sm border border-border/60 bg-input px-1.5 text-xs"
    />
  </div>
</div>
<form
  class="grid items-center border-b border-b-border/60 px-3 py-2.5"
  onsubmit={onSubmit}
>
  <SearchInput
    bind:value={query}
    onValueChange={() => onQueryChange?.(query)}
    placeholder="Filter folders or paste a path"
    disabled={loading}
    inputClass="font-mono"
    ariaLabel="Filter folders or enter a path"
  />
</form>

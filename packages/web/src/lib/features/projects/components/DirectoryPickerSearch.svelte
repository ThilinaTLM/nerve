<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import MoveUp from "@lucide/svelte/icons/move-up";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Search from "@lucide/svelte/icons/search";
  import { Button } from "@nervekit/shared-ui/components/ui/button";
  import { Input } from "@nervekit/shared-ui/components/ui/input";
  import Switch from "@nervekit/shared-ui/components/ui/switch-field";
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

<div class="path-bar">
  {#if onBack}
    <Button variant="ghost" size="icon-sm" title="Back to recents" ariaLabel="Back to recents" onclick={onBack}>
      <ArrowLeft size={15} strokeWidth={2.2} />
    </Button>
    <span class="path-tools-sep" aria-hidden="true"></span>
  {/if}
  <nav class="crumbs" aria-label="Current location">
    {#each crumbs as crumb, i}
      {#if i > 0}<ChevronRight class="crumb-sep" size={13} strokeWidth={2.2} aria-hidden="true" />{/if}
      {#if i === crumbs.length - 1}
        <span class="crumb current" title={crumb.path}>{crumb.label}</span>
      {:else}
        <button class="crumb app-interactive-row" type="button" title={crumb.path} disabled={loading} onclick={() => onLoad?.(crumb.path)}>
          {crumb.label}
        </button>
      {/if}
    {/each}
  </nav>
  <div class="path-tools">
    <Button variant="ghost" size="icon-sm" disabled={!parent || loading} title="Parent directory" ariaLabel="Parent directory" onclick={() => onLoad?.(parent)}>
      <MoveUp size={14} strokeWidth={2.2} />
    </Button>
    <Button variant="ghost" size="icon-sm" disabled={loading} title="Refresh" ariaLabel="Refresh" onclick={onReload}>
      <RefreshCw size={14} strokeWidth={2.2} />
    </Button>
    <span class="path-tools-sep" aria-hidden="true"></span>
    <Switch bind:checked={showHidden} label="Hidden" class="hidden-switch" />
  </div>
</div>
<form class="picker-search" onsubmit={onSubmit}>
  <Search size={14} strokeWidth={2.2} aria-hidden="true" />
  <Input
    bind:value={query}
    oninput={() => onQueryChange?.(query)}
    placeholder="Filter folders or paste a path"
    disabled={loading}
    size="sm"
    ariaLabel="Filter folders or enter a path"
  />
</form>

<script lang="ts">
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import MoveUp from "@lucide/svelte/icons/move-up";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import Switch from "@nervekit/ui-kit/components/composites/switch-field";
type Props = {
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
  class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 border-b border-border/50 p-2"
>
  <span class="flex size-8 items-center justify-center">
    {#if onBack}
      <Button
        variant="ghost"
        size="icon-sm"
        title="Back to projects"
        ariaLabel="Back to projects"
        onclick={onBack}
      >
        <ArrowLeft size={15} strokeWidth={2.2} />
      </Button>
    {/if}
  </span>

  <form
    class="col-span-3 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1"
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

  <div
    class="col-start-3 row-start-1 flex flex-none items-center justify-end gap-0.5"
  >
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
    <Switch
      bind:checked={showHidden}
      label="Hidden"
      class="h-7 gap-1.5 px-1 text-xs"
    />
  </div>
</div>

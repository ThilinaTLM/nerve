<script lang="ts">
import { tick } from "svelte";
import X from "@lucide/svelte/icons/x";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import SearchInput from "@nervekit/ui-kit/components/ui/search-input";

type Props = {
  contains: string;
  rowCount: number;
  loading: boolean;
  focusRequest: number;
  onContainsChange: (value: string) => void;
  onClose: () => void;
};

let {
  contains,
  rowCount,
  loading,
  focusRequest,
  onContainsChange,
  onClose,
}: Props = $props();
let input: HTMLInputElement | null = $state(null);

$effect(() => {
  void focusRequest;
  void tick().then(() => {
    input?.focus();
    input?.select();
  });
});
</script>

<div
  class="absolute top-3 right-3 left-3 z-20 grid gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-sm sm:left-auto sm:w-96"
  role="search"
  aria-label="Find in logs"
>
  <SearchInput
    bind:ref={input}
    value={contains}
    class="w-full"
    inputClass="border-0 bg-transparent shadow-none"
    placeholder="Find in logs"
    ariaLabel="Find in logs"
    onValueChange={onContainsChange}
  />

  <div class="flex min-w-0 items-center justify-between gap-2">
    <span
      class="min-w-0 truncate px-1 text-xs tabular-nums text-muted-foreground"
      aria-live="polite"
    >
      {loading
        ? "Searching…"
        : contains.trim()
          ? `${rowCount} matching`
          : `${rowCount} loaded`}
    </span>
    <Button
      size="icon-xs"
      variant="ghost"
      ariaLabel="Close find"
      title="Close find"
      onclick={onClose}
    >
      <X class="size-3.5" aria-hidden="true" />
    </Button>
  </div>
</div>

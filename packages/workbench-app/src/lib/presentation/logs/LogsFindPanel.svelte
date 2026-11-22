<script lang="ts">
import { tick } from "svelte";
import X from "@lucide/svelte/icons/x";
import {
  FloatingPanel,
  FloatingToolbarButton,
  FloatingToolbarText,
} from "@nervekit/ui-kit/components/composites/floating-toolbar";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";

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

<FloatingPanel label="Find in logs" role="search" {onClose}>
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
    <FloatingToolbarText live>
      {loading
        ? "Searching…"
        : contains.trim()
          ? `${rowCount} matching`
          : `${rowCount} loaded`}
    </FloatingToolbarText>
    <FloatingToolbarButton
      label="Close find"
      icon={X}
      shortcut="Esc"
      onclick={onClose}
    />
  </div>
</FloatingPanel>

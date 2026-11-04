<script lang="ts">
import { onMount, untrack } from "svelte";
import { validateEntryName } from "../state/file-explorer-paths";

let {
  initialName = "",
  selectionEnd,
  siblings,
  current,
  ariaLabel,
  onValueChange,
  onCommit,
  onCancel,
}: {
  initialName?: string;
  /** Characters preselected on focus (the base name when renaming a file). */
  selectionEnd?: number;
  siblings: ReadonlySet<string>;
  /** The name being replaced, which is allowed to stay unchanged. */
  current?: string;
  ariaLabel: string;
  onValueChange?: (value: string) => void;
  onCommit: (name: string) => void;
  onCancel: () => void;
} = $props();

let value = $state(untrack(() => initialName));
let input: HTMLInputElement | undefined = $state();
let settled = false;

const error = $derived(
  value === "" ? undefined : validateEntryName(value, siblings, current),
);

onMount(() => {
  input?.focus();
  input?.setSelectionRange(0, selectionEnd ?? value.length);
});

function commit(): void {
  if (settled) return;
  const name = value.trim();
  if (!name || name === current) return cancel();
  if (validateEntryName(name, siblings, current)) return;
  settled = true;
  onCommit(name);
}

function cancel(): void {
  if (settled) return;
  settled = true;
  onCancel();
}

function handleKeydown(event: KeyboardEvent): void {
  event.stopPropagation();
  if (event.key === "Enter") {
    event.preventDefault();
    commit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    cancel();
  }
}

function handleBlur(): void {
  // Leaving the field applies a valid change and drops anything else.
  if (!settled && !error) commit();
  else cancel();
}
</script>

<span class="relative flex min-w-0 flex-1">
  <input
    bind:this={input}
    bind:value
    type="text"
    spellcheck="false"
    autocomplete="off"
    aria-label={ariaLabel}
    aria-invalid={error ? true : undefined}
    class="h-5 min-w-0 flex-1 rounded-sm border bg-input-background px-1 text-ui text-foreground outline-none focus-visible:border-ring aria-invalid:border-destructive"
    oninput={() => onValueChange?.(value)}
    onkeydown={handleKeydown}
    onblur={handleBlur}
    onclick={(event) => event.stopPropagation()}
  />
  {#if error}
    <span
      role="alert"
      class="absolute top-full left-0 z-20 mt-0.5 max-w-64 rounded-sm bg-popover px-2 py-1 text-caption text-destructive shadow-overlay"
      >{error}</span
    >
  {/if}
</span>

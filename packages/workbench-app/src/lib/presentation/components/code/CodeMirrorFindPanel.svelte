<script lang="ts">
import CaseSensitive from "@lucide/svelte/icons/case-sensitive";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronUp from "@lucide/svelte/icons/chevron-up";
import Regex from "@lucide/svelte/icons/regex";
import WholeWord from "@lucide/svelte/icons/whole-word";
import X from "@lucide/svelte/icons/x";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { tick } from "svelte";

let {
  query,
  caseSensitive,
  wholeWord,
  regexp,
  status,
  valid,
  onQueryChange,
  onCaseSensitiveChange,
  onWholeWordChange,
  onRegexpChange,
  onPrevious,
  onNext,
  onClose,
}: {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
  status: string;
  valid: boolean;
  onQueryChange: (value: string) => void;
  onCaseSensitiveChange: (value: boolean) => void;
  onWholeWordChange: (value: boolean) => void;
  onRegexpChange: (value: boolean) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
} = $props();

let panel: HTMLFormElement | null = $state(null);
let input: HTMLTextAreaElement | null = $state(null);

$effect(() => {
  void tick().then(() => {
    input?.focus();
    input?.select();
  });
});

function handleKeydown(event: KeyboardEvent) {
  if (
    !panel ||
    !(event.target instanceof Node) ||
    !panel.contains(event.target)
  )
    return;
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    if (event.shiftKey) onPrevious();
    else onNext();
  }
}
</script>

<svelte:window onkeydown={handleKeydown} />

<form
  bind:this={panel}
  class="absolute left-2 right-2 top-2 z-10 grid gap-1 rounded-md border border-border bg-popover/90 p-1 text-popover-foreground shadow-sm backdrop-blur-sm sm:left-auto sm:w-96"
  role="search"
  aria-label="Find in file"
  onsubmit={(event) => event.preventDefault()}
>
  <Textarea
    bind:ref={input}
    class="max-h-24 min-h-7 resize-y border-0 bg-transparent px-2 py-1 font-mono text-xs leading-5 shadow-none"
    value={query}
    rows={1}
    aria-label="Find text"
    aria-invalid={!valid}
    placeholder="Find"
    oninput={(event) => onQueryChange(event.currentTarget.value)}
  />
  <div class="flex min-w-0 items-center justify-between gap-2">
    <span
      class={`min-w-0 truncate px-1 text-xs ${valid ? "text-muted-foreground" : "text-destructive"}`}
      aria-live="polite"
    >
      {valid ? status : "Invalid pattern"}
    </span>
    <div
      class="flex shrink-0 items-center gap-0.5"
      role="group"
      aria-label="Find options"
    >
      <Button
        variant="ghost"
        size="icon-xs"
        pressed={caseSensitive}
        active={caseSensitive}
        ariaLabel="Match case"
        title="Match case"
        onclick={() => onCaseSensitiveChange(!caseSensitive)}
      >
        <CaseSensitive class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        pressed={wholeWord}
        active={wholeWord}
        ariaLabel="Match whole word"
        title="Match whole word"
        onclick={() => onWholeWordChange(!wholeWord)}
      >
        <WholeWord class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        pressed={regexp}
        active={regexp}
        ariaLabel="Use regular expression"
        title="Use regular expression"
        onclick={() => onRegexpChange(!regexp)}
      >
        <Regex class="size-3.5" />
      </Button>
      <span class="mx-0.5 h-4 w-px bg-border" aria-hidden="true"></span>
      <Button
        variant="ghost"
        size="icon-xs"
        ariaLabel="Previous match"
        title="Previous match (Ctrl/Cmd+Shift+Enter)"
        disabled={!query || !valid}
        onclick={onPrevious}
      >
        <ChevronUp class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        ariaLabel="Next match"
        title="Next match (Ctrl/Cmd+Enter)"
        disabled={!query || !valid}
        onclick={onNext}
      >
        <ChevronDown class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        ariaLabel="Close find"
        title="Close find (Escape)"
        onclick={onClose}
      >
        <X class="size-3.5" />
      </Button>
    </div>
  </div>
</form>

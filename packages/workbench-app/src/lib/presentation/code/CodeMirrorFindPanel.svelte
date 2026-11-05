<script lang="ts">
import CaseSensitive from "@lucide/svelte/icons/case-sensitive";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import ChevronUp from "@lucide/svelte/icons/chevron-up";
import Regex from "@lucide/svelte/icons/regex";
import Replace from "@lucide/svelte/icons/replace";
import ReplaceAll from "@lucide/svelte/icons/replace-all";
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
  focusRequest = 0,
  canReplace = false,
  replaceOpen = false,
  replacement = "",
  onQueryChange,
  onCaseSensitiveChange,
  onWholeWordChange,
  onRegexpChange,
  onPrevious,
  onNext,
  onClose,
  onReplaceOpenChange,
  onReplacementChange,
  onReplace,
  onReplaceAll,
}: {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
  status: string;
  valid: boolean;
  focusRequest?: number;
  canReplace?: boolean;
  replaceOpen?: boolean;
  replacement?: string;
  onQueryChange: (value: string) => void;
  onCaseSensitiveChange: (value: boolean) => void;
  onWholeWordChange: (value: boolean) => void;
  onRegexpChange: (value: boolean) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onReplaceOpenChange?: (open: boolean) => void;
  onReplacementChange?: (value: string) => void;
  onReplace?: () => void;
  onReplaceAll?: () => void;
} = $props();

let panel: HTMLFormElement | null = $state(null);
let input: HTMLTextAreaElement | null = $state(null);
const showReplace = $derived(canReplace && replaceOpen);
const canSearch = $derived(Boolean(query) && valid);

$effect(() => {
  void focusRequest;
  void tick().then(() => {
    input?.focus();
    input?.select();
  });
});

/* Enter/Shift+Enter step through matches (Replace in the replace field);
 * Ctrl/Cmd+Enter inserts a newline for multi-line patterns. */
function handleFieldKeydown(event: KeyboardEvent, field: "find" | "replace") {
  if (event.key !== "Enter" || event.isComposing) return;
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    const target = event.currentTarget as HTMLTextAreaElement;
    target.setRangeText(
      "\n",
      target.selectionStart,
      target.selectionEnd,
      "end",
    );
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  event.preventDefault();
  if (field === "replace") {
    if (event.altKey) onReplaceAll?.();
    else onReplace?.();
  } else if (event.shiftKey) onPrevious();
  else onNext();
}

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
  }
}
</script>

<svelte:window onkeydown={handleKeydown} />

<form
  bind:this={panel}
  class="floating-surface absolute top-3 right-3 left-3 z-10 flex gap-0.5 p-1 sm:left-auto sm:w-104"
  role="search"
  aria-label={canReplace ? "Find and replace" : "Find in file"}
  onsubmit={(event) => event.preventDefault()}
>
  {#if canReplace}
    <Button
      variant="ghost"
      size="icon-sm"
      class="self-start"
      ariaLabel={showReplace ? "Hide replace" : "Show replace"}
      title={showReplace ? "Hide replace" : "Show replace"}
      onclick={() => onReplaceOpenChange?.(!replaceOpen)}
    >
      {#if showReplace}
        <ChevronDown class="size-3.5" />
      {:else}
        <ChevronRight class="size-3.5" />
      {/if}
    </Button>
  {/if}
  <div class="grid min-w-0 flex-1 gap-1">
    <Textarea
      bind:ref={input}
      class="max-h-24 resize-y border-0 bg-transparent px-2 py-1 font-mono text-ui leading-5 shadow-none"
      value={query}
      rows={1}
      aria-label="Find text"
      aria-invalid={!valid}
      placeholder="Find"
      oninput={(event) => onQueryChange(event.currentTarget.value)}
      onkeydown={(event) => handleFieldKeydown(event, "find")}
    />
    {#if showReplace}
      <div class="flex min-w-0 items-start gap-0.5">
        <Textarea
          class="max-h-24 min-w-0 flex-1 resize-y border-0 bg-transparent px-2 py-1 font-mono text-ui leading-5 shadow-none"
          value={replacement}
          rows={1}
          aria-label="Replace with"
          placeholder={regexp ? "Replace ($1, $& for groups)" : "Replace"}
          oninput={(event) => onReplacementChange?.(event.currentTarget.value)}
          onkeydown={(event) => handleFieldKeydown(event, "replace")}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          ariaLabel="Replace"
          title="Replace (Enter)"
          disabled={!canSearch}
          onclick={onReplace}
        >
          <Replace class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          ariaLabel="Replace all"
          title="Replace all (Alt+Enter)"
          disabled={!canSearch}
          onclick={onReplaceAll}
        >
          <ReplaceAll class="size-3.5" />
        </Button>
      </div>
    {/if}
    <div class="flex min-w-0 items-center justify-between gap-2">
      <span
        class={`min-w-0 truncate px-1 text-ui ${valid ? "text-muted-foreground" : "text-destructive"}`}
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
          size="icon-sm"
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
          size="icon-sm"
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
          size="icon-sm"
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
          size="icon-sm"
          ariaLabel="Previous match"
          title="Previous match (Shift+Enter)"
          disabled={!canSearch}
          onclick={onPrevious}
        >
          <ChevronUp class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          ariaLabel="Next match"
          title="Next match (Enter)"
          disabled={!canSearch}
          onclick={onNext}
        >
          <ChevronDown class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          ariaLabel="Close find"
          title="Close find (Escape)"
          onclick={onClose}
        >
          <X class="size-3.5" />
        </Button>
      </div>
    </div>
  </div>
</form>

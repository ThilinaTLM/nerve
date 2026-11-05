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
import { Input } from "@nervekit/ui-kit/components/ui/input";
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
let input: HTMLInputElement | null = $state(null);
const showReplace = $derived(canReplace && replaceOpen);
const canSearch = $derived(Boolean(query) && valid);
const noMatches = $derived(Boolean(query) && valid && status === "No results");

$effect(() => {
  void focusRequest;
  void tick().then(() => {
    input?.focus();
    input?.select();
  });
});

/* Enter/Shift+Enter step through matches; in the replace field Enter
 * replaces and Alt+Enter replaces all. Multi-line patterns use `\n`. */
function handleFieldKeydown(event: KeyboardEvent, field: "find" | "replace") {
  if (event.key !== "Enter" || event.isComposing) return;
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

{#snippet option(
  label: string,
  pressed: boolean,
  onToggle: (value: boolean) => void,
  Icon: typeof CaseSensitive,
)}
  <Button
    variant="ghost"
    size="icon-sm"
    {pressed}
    active={pressed}
    ariaLabel={label}
    title={label}
    onclick={() => onToggle(!pressed)}
  >
    <Icon class="size-3.5" />
  </Button>
{/snippet}

<form
  bind:this={panel}
  class="floating-surface absolute top-2 right-3 left-3 z-10 grid gap-1 p-1 sm:left-auto sm:w-112"
  role="search"
  aria-label={canReplace ? "Find and replace" : "Find in file"}
  onsubmit={(event) => event.preventDefault()}
>
  <div class="flex min-w-0 items-center gap-1">
    {#if canReplace}
      <Button
        variant="ghost"
        size="icon-sm"
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
    <div class="relative min-w-0 flex-1">
      <Input
        bind:ref={input}
        class="pr-20 font-mono placeholder:font-sans"
        value={query}
        spellcheck={false}
        autocomplete="off"
        aria-label="Find text"
        aria-invalid={!valid || noMatches}
        placeholder="Find"
        title="Enter: next match · Shift+Enter: previous · \n matches a line break"
        oninput={(event) => onQueryChange(event.currentTarget.value)}
        onkeydown={(event) => handleFieldKeydown(event, "find")}
      />
      <div
        class="absolute inset-y-0 right-0.5 flex items-center"
        role="group"
        aria-label="Find options"
      >
        {@render option(
          "Match case",
          caseSensitive,
          onCaseSensitiveChange,
          CaseSensitive,
        )}
        {@render option(
          "Match whole word",
          wholeWord,
          onWholeWordChange,
          WholeWord,
        )}
        {@render option(
          "Use regular expression",
          regexp,
          onRegexpChange,
          Regex,
        )}
      </div>
    </div>
    <span
      class={`w-20 shrink-0 truncate text-center text-ui tabular-nums ${valid && !noMatches ? "text-muted-foreground" : "text-destructive"}`}
      aria-live="polite"
    >
      {valid ? (query ? status : "") : "Invalid regex"}
    </span>
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
      title="Close (Escape)"
      onclick={onClose}
    >
      <X class="size-3.5" />
    </Button>
  </div>
  {#if showReplace}
    <div class="flex min-w-0 items-center gap-1">
      <span class="size-control-sm shrink-0" aria-hidden="true"></span>
      <Input
        class="min-w-0 flex-1 font-mono placeholder:font-sans"
        value={replacement}
        spellcheck={false}
        autocomplete="off"
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
      <!-- Aligns the replace actions with prev/next above. -->
      <span class="size-control-sm shrink-0" aria-hidden="true"></span>
    </div>
  {/if}
</form>

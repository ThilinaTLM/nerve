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
import {
  FloatingPanel,
  FloatingToolbarButton,
  FloatingToolbarText,
  rowIn,
  rowOut,
} from "@nervekit/ui-kit/components/composites/floating-toolbar";
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
</script>

{#snippet option(
  label: string,
  pressed: boolean,
  onToggle: (value: boolean) => void,
  icon: typeof CaseSensitive,
)}
  <FloatingToolbarButton
    {label}
    {icon}
    {pressed}
    onclick={() => onToggle(!pressed)}
  />
{/snippet}

<FloatingPanel
  label={canReplace ? "Find and replace" : "Find in file"}
  role="search"
  size="lg"
  {onClose}
>
  <div class="flex min-w-0 items-center gap-1">
    {#if canReplace}
      <FloatingToolbarButton
        label={showReplace ? "Hide replace" : "Show replace"}
        icon={showReplace ? ChevronDown : ChevronRight}
        onclick={() => onReplaceOpenChange?.(!replaceOpen)}
      />
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
    <FloatingToolbarText
      class="w-20 justify-center"
      tone={valid && !noMatches ? "muted" : "destructive"}
      live
    >
      {valid ? (query ? status : "") : "Invalid regex"}
    </FloatingToolbarText>
    <FloatingToolbarButton
      label="Previous match"
      icon={ChevronUp}
      shortcut="Shift+Enter"
      disabled={!canSearch}
      onclick={onPrevious}
    />
    <FloatingToolbarButton
      label="Next match"
      icon={ChevronDown}
      shortcut="Enter"
      disabled={!canSearch}
      onclick={onNext}
    />
    <FloatingToolbarButton
      label="Close"
      icon={X}
      shortcut="Esc"
      onclick={onClose}
    />
  </div>
  {#if showReplace}
    <div class="flex min-w-0 items-center gap-1" in:rowIn out:rowOut>
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
      <FloatingToolbarButton
        label="Replace"
        icon={Replace}
        shortcut="Enter"
        disabled={!canSearch}
        onclick={onReplace}
      />
      <FloatingToolbarButton
        label="Replace all"
        icon={ReplaceAll}
        shortcut="Alt+Enter"
        disabled={!canSearch}
        onclick={onReplaceAll}
      />
      <!-- Aligns the replace actions with prev/next above. -->
      <span class="size-control-sm shrink-0" aria-hidden="true"></span>
    </div>
  {/if}
</FloatingPanel>

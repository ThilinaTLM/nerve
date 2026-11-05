<script lang="ts">
import type { Snippet } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { CursorStatus } from "./code-viewer-helpers";

let {
  cursor,
  indentation,
  lineEnding,
  language,
  message,
  onGoToLine,
}: {
  cursor: CursorStatus;
  indentation: string;
  lineEnding: string;
  language?: string;
  message?: Snippet;
  onGoToLine?: () => void;
} = $props();

const position = $derived(
  `Ln ${cursor.line}, Col ${cursor.column}${
    cursor.selections > 1
      ? ` (${cursor.selections} selections)`
      : cursor.selectedLength > 0
        ? ` (${cursor.selectedLength} selected)`
        : ""
  }`,
);
</script>

<footer
  class="flex h-control-sm min-w-0 shrink-0 items-center gap-3 border-t border-border-subtle px-2 text-ui text-muted-foreground"
  aria-label="Editor status"
>
  <div class="min-w-0 flex-1 truncate">{@render message?.()}</div>
  <div class="flex shrink-0 items-center gap-1 tabular-nums">
    <Button
      variant="ghost"
      size="sm"
      class="text-muted-foreground"
      title="Go to line"
      ariaLabel={`${position}. Go to line`}
      disabled={!onGoToLine}
      onclick={onGoToLine}
    >
      {position}
    </Button>
    <span class="px-1.5">{indentation}</span>
    <span class="px-1.5">{lineEnding}</span>
    <span class="px-1.5">UTF-8</span>
    {#if language}
      <span class="hidden px-1.5 sm:inline">{language}</span>
    {/if}
  </div>
</footer>

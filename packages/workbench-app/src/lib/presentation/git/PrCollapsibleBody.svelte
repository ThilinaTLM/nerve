<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import Markdown from "@nervekit/ui-kit/core/components/Markdown.svelte";
import { notifyCopyResult } from "@nervekit/ui-kit/core/notify";

// Keep in sync with COLLAPSED_BODY_LINES in pr-pane-helpers.ts (the literal
// class is required for Tailwind's static scan).
type Props = { body: string };
let { body }: Props = $props();
let open = $state(false);
</script>

<div class="grid gap-1">
  <div class="text-sm {open ? '' : 'line-clamp-14'}">
    <Markdown text={body} onCopy={notifyCopyResult} />
  </div>
  <button
    type="button"
    onclick={() => (open = !open)}
    class="inline-flex w-fit items-center gap-0.5 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground"
  >
    <ChevronDown
      class="size-3 transition-transform {open ? 'rotate-180' : ''}"
      aria-hidden="true"
    />
    {open ? "Show less" : "Show more"}
  </button>
</div>

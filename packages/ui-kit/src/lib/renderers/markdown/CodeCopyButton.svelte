<script lang="ts">
import { onDestroy } from "svelte";
import { Check, Copy } from "@lucide/svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { writeClipboardText } from "@nervekit/ui-kit/browser/clipboard";

let { code, onCopy }: { code: string; onCopy?: (ok: boolean) => void } =
  $props();
let copied = $state(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

onDestroy(() => clearTimeout(resetTimer));

async function copy() {
  if (!code) return;
  try {
    await writeClipboardText(code);
  } catch {
    onCopy?.(false);
    return;
  }
  clearTimeout(resetTimer);
  copied = true;
  resetTimer = setTimeout(() => {
    copied = false;
  }, 1600);
  onCopy?.(true);
}
</script>

<Button
  variant="ghost"
  size="icon-sm"
  class={copied
    ? "bg-well text-success hover:text-success"
    : "bg-well text-muted-foreground"}
  aria-label={copied ? "Copied code" : "Copy code"}
  title={copied ? "Copied!" : "Copy code"}
  onclick={copy}
>
  {#if copied}
    <Check class="motion-safe:animate-[copy-confirm_180ms_ease-out]" />
  {:else}
    <Copy />
  {/if}
</Button>

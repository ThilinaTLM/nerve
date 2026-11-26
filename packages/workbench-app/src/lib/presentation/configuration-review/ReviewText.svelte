<!-- A sentence from the daemon, with `code` spans shown as inline code. Plain text only. -->
<script lang="ts">
import { codeSpans } from "./review-format";

let { text }: { text: string } = $props();
</script>

{#each codeSpans(text) as part, index (index)}{#if part.code}<code
      class="rounded-sm bg-muted px-1 font-mono break-all">{part.text}</code
    >{:else}{part.text}{/if}{/each}

<script lang="ts">
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import ResultCodeBlock from "../../tools/tool-call/ResultCodeBlock.svelte";
import type { NoticeDetails } from "./notice-presentation";

type Props = {
  open?: boolean;
  details: NoticeDetails;
};

let { open = $bindable(false), details }: Props = $props();
</script>

<DialogShell
  bind:open
  title={details.title}
  description={details.description}
  size="wide"
>
  {#if open}
    <ResultCodeBlock
      code={details.text}
      language={details.language}
      maxHeight="70vh"
      trim={false}
      highlight={Boolean(details.language) && details.text.length <= 256 * 1024}
    />
  {/if}
</DialogShell>

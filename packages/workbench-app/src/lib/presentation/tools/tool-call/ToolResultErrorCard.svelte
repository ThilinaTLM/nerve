<script lang="ts">
import { trimTextPreview } from "@nervekit/ui-kit/display/text-preview";
import StatusGlyph from "../../cards/StatusGlyph.svelte";
import CardSheet from "../../cards/CardSheet.svelte";
import CardSheetError from "../../cards/CardSheetError.svelte";

type Props = {
  toolName: string;
  error: string;
};

let { toolName, error }: Props = $props();

const errorPreview = $derived(
  trimTextPreview(error, { headLines: 18, tailLines: 6, maxChars: 6_000 }).text,
);
</script>

<article class="grid w-full gap-1.5 py-2.5">
  <div class="min-w-0 leading-normal">
    <StatusGlyph tone="destructive" size={14} class="mr-1.5 align-middle" />
    <span class="font-mono text-ui font-semibold text-foreground"
      >{toolName}</span
    >
  </div>
  <CardSheet>
    <CardSheetError text={errorPreview} />
  </CardSheet>
</article>

<script lang="ts">
import { parseUnifiedDiff, type DiffLineTone } from "./unified-diff";

type Props = { patch: string };
let { patch }: Props = $props();

const lines = $derived(parseUnifiedDiff(patch));

function rowClass(tone: DiffLineTone): string {
  if (tone === "add") return "bg-success/10 text-success";
  if (tone === "delete") return "bg-destructive/10 text-destructive";
  if (tone === "hunk") return "bg-info/10 text-info";
  if (tone === "file") return "bg-muted font-semibold text-foreground";
  return "text-foreground";
}

function gutterClass(tone: DiffLineTone): string {
  if (tone === "add") return "bg-success/10";
  if (tone === "delete") return "bg-destructive/10";
  if (tone === "hunk") return "bg-info/10";
  if (tone === "file") return "bg-muted";
  return "bg-background";
}
</script>

<pre class="min-w-max py-1 font-mono text-xs leading-5"><code
    >{#each lines as line, index (`${index}:${line.text}`)}<span
        class={`flex min-w-full w-max ${rowClass(line.tone)}`}
        ><span
          class={`sticky left-0 w-10 flex-none border-r border-border/40 pr-2 text-right font-normal text-muted-foreground select-none ${gutterClass(line.tone)}`}
          aria-hidden="true">{line.oldLine ?? ""}</span
        ><span
          class={`sticky left-10 w-10 flex-none border-r border-border/40 pr-2 text-right font-normal text-muted-foreground select-none ${gutterClass(line.tone)}`}
          aria-hidden="true">{line.newLine ?? ""}</span
        ><span class="min-w-max flex-1 px-3">{line.text || " "}</span></span
      >{/each}</code
  ></pre>

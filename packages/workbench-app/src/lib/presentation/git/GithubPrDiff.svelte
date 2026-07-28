<script lang="ts">
type DiffTone = "add" | "delete" | "hunk" | "file" | "context";
type DiffLine = { text: string; tone: DiffTone };

type Props = { patch: string };
let { patch }: Props = $props();

function lineTone(line: string): DiffTone {
  if (line.startsWith("@@")) return "hunk";
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("diff ")
  )
    return "file";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "delete";
  return "context";
}

const lines = $derived(
  patch
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((text): DiffLine => ({ text, tone: lineTone(text) })),
);
</script>

<pre class="min-w-max py-1 font-mono text-xs leading-5"><code
    >{#each lines as line, index (`${index}:${line.text}`)}<span
        class={line.tone === "add"
          ? "block bg-success/10 px-3 text-success"
          : line.tone === "delete"
            ? "block bg-destructive/10 px-3 text-destructive"
            : line.tone === "hunk"
              ? "block bg-info/10 px-3 text-info"
              : line.tone === "file"
                ? "block bg-muted px-3 font-semibold text-foreground"
                : "block px-3 text-foreground"}>{line.text || " "}</span
      >{/each}</code
  ></pre>

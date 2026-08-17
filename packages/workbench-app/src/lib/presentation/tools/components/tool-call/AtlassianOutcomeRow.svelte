<script lang="ts">
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleDashed from "@lucide/svelte/icons/circle-dashed";
import Info from "@lucide/svelte/icons/info";
import Trash2 from "@lucide/svelte/icons/trash-2";

type Tone = "default" | "success" | "info" | "warning" | "destructive";
type Props = {
  title: string;
  detail?: string;
  tone?: Tone;
};

let { title, detail, tone = "default" }: Props = $props();

const Icon = $derived(
  tone === "destructive"
    ? Trash2
    : tone === "success"
      ? CircleCheck
      : tone === "info" || tone === "warning"
        ? Info
        : CircleDashed,
);
const toneClass = $derived(
  tone === "destructive"
    ? "text-destructive"
    : tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "info"
          ? "text-info"
          : "text-muted-foreground",
);
</script>

<div class="flex min-w-0 gap-2 px-2.5 py-2">
  <Icon size={14} strokeWidth={2} class={`mt-0.5 shrink-0 ${toneClass}`} />
  <div class="min-w-0">
    <p class={`m-0 text-xs font-medium leading-snug ${toneClass}`}>{title}</p>
    {#if detail}
      <p
        class="m-0 mt-0.5 whitespace-pre-wrap text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]"
      >
        {detail}
      </p>
    {/if}
  </div>
</div>

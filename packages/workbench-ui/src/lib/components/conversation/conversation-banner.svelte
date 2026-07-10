<script lang="ts">
  let {
    title,
    message,
    tone = "muted",
  }: {
    title: string;
    message?: string;
    tone?: "muted" | "warning";
  } = $props();
</script>

<div
  class={`flex-none border-b px-4 py-2 text-xs text-muted-foreground ${tone === "warning" ? "bg-warning/10" : "bg-muted/40"}`}
>
  <span class="font-medium text-foreground">{title}</span>
  {#if message} {message}{/if}
</div>

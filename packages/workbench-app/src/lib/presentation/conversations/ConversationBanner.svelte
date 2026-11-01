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
  class={`flex-none border-b px-4 py-2 text-ui text-muted-foreground ${tone === "warning" ? "bg-warning-subtle" : "bg-muted"}`}
>
  <span class="text-foreground">{title}</span>
  {#if message}
    {message}{/if}
</div>

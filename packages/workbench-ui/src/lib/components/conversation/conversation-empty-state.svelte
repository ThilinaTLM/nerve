<script lang="ts">
  import MessageSquareOff from "@lucide/svelte/icons/message-square-off";

  let {
    title = "No conversation selected.",
    message,
  }: {
    title?: string;
    message?: string;
  } = $props();
</script>

<div class="flex min-h-0 flex-col items-center justify-center gap-2 p-4 text-center">
  <MessageSquareOff class="size-8 text-muted-foreground" />
  <p class="text-sm text-muted-foreground">{title}</p>
  {#if message}
    <p class="max-w-md text-xs text-muted-foreground">{message}</p>
  {/if}
</div>

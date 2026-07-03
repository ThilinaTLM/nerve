<script lang="ts">
  import { Send, Square } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";

  let {
    value = $bindable(""),
    sending = false,
    canCancel = false,
    disabled = false,
    onsend,
    oncancel,
  }: {
    value?: string;
    sending?: boolean;
    canCancel?: boolean;
    disabled?: boolean;
    onsend: (text: string) => void;
    oncancel: () => void;
  } = $props();

  function submit() {
    if (!value.trim() || sending) return;
    onsend(value);
  }
</script>

<div class="flex flex-col gap-2 border-t p-3">
  <Textarea
    bind:value
    class="min-h-16 resize-none"
    placeholder={disabled
      ? "No controller session connected."
      : "Send a prompt to this sandbox…"}
    disabled={disabled}
    onkeydown={(event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submit();
      }
    }}
  />
  <div class="flex items-center justify-between">
    <span class="text-xs text-muted-foreground">⌘/Ctrl + Enter to send</span>
    <div class="flex items-center gap-2">
      {#if canCancel}
        <Button variant="ghost" size="sm" onclick={oncancel}>
          <Square class="size-4" /> Stop
        </Button>
      {/if}
      <Button size="sm" disabled={disabled || sending || !value.trim()} onclick={submit}>
        <Send class="size-4" /> Send
      </Button>
    </div>
  </div>
</div>

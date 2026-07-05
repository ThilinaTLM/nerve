<script lang="ts">
  let {
    value = "",
    disabled = false,
    placeholder = "Message the agent…",
    onSubmit,
    onAbort,
  }: {
    value?: string;
    disabled?: boolean;
    placeholder?: string;
    onSubmit?: (text: string) => void | Promise<void>;
    onAbort?: () => void | Promise<void>;
  } = $props();

  let text = $state<string>("");

  $effect(() => {
    if (!text) text = value;
  });

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    await onSubmit?.(trimmed);
    text = "";
  }
</script>

<div class="border-t bg-background p-4">
  <div class="flex gap-2 rounded-lg border bg-card p-2 shadow-sm">
    <textarea
      bind:value={text}
      {placeholder}
      {disabled}
      rows="3"
      class="min-h-20 flex-1 resize-none bg-transparent p-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
      onkeydown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          void submit();
        }
      }}
    ></textarea>
    <div class="flex flex-col gap-2">
      <button class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60" {disabled} onclick={submit}>Send</button>
      {#if onAbort}
        <button class="rounded-md border px-3 py-2 text-sm font-medium" onclick={() => onAbort?.()}>Abort</button>
      {/if}
    </div>
  </div>
</div>

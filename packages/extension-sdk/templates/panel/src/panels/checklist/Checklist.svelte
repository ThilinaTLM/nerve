<script lang="ts">
import { Button, Checkbox, host } from "@nervekit/extension-sdk/ui";

type Item = { text: string; done: boolean };
let items = $state<Item[]>([]);
let draft = $state("");

// The host keeps the panel's view state; read it back when the panel opens.
$effect(() => {
  void host.viewState.get().then((state) => {
    if (state && typeof state === "object" && "items" in state)
      items = state.items as Item[];
  });
});

function save() {
  void host.viewState.set({ items });
}

function add() {
  if (!draft.trim()) return;
  items.push({ text: draft.trim(), done: false });
  draft = "";
  save();
}
</script>

<div class="flex h-screen flex-col gap-2 bg-panel p-3 text-foreground">
  <div class="flex gap-2">
    <input
      class="h-control min-w-0 flex-1 rounded-md border border-input bg-input-background px-2 text-ui"
      placeholder="Add an item"
      bind:value={draft}
      onkeydown={(event) => {
        if (event.key === "Enter") add();
      }}
    />
    <Button onclick={add}>Add</Button>
  </div>
  {#if items.length === 0}
    <p class="text-ui text-muted-foreground">No items yet.</p>
  {/if}
  <ul class="min-h-0 flex-1 overflow-auto">
    {#each items as item, index (index)}
      <li class="flex items-center gap-2 py-1 text-ui">
        <Checkbox bind:checked={item.done} onCheckedChange={save} />
        <span class={item.done ? "text-muted-foreground line-through" : ""}>
          {item.text}
        </span>
      </li>
    {/each}
  </ul>
</div>

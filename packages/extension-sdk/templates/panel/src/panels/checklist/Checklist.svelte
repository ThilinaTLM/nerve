<script lang="ts">
import {
  Circle,
  CircleCheck,
  ListChecks,
  Plus,
  Trash2,
} from "@nervekit/extension-sdk/ui";
import {
  host,
  Input,
  PanelEmpty,
  PanelFilterBar,
  PanelHeader,
  PanelList,
  PanelRow,
  PanelToolbarButton,
  PanelView,
  ScrollArea,
} from "@nervekit/extension-sdk/ui";

type Item = { id: string; text: string; done: boolean };
let items = $state<Item[]>([]);
let draft = $state("");
let query = $state("");
let scope = $state("all");

const open = $derived(items.filter((item) => !item.done).length);
const shown = $derived(
  items.filter(
    (item) =>
      (scope === "all" || item.done === (scope === "done")) &&
      item.text.toLowerCase().includes(query.trim().toLowerCase()),
  ),
);

// The host keeps the panel's view state; read it back when the panel opens.
$effect(() => {
  void host.tabState.get().then((state) => {
    if (state && typeof state === "object" && "items" in state)
      items = state.items as Item[];
  });
});

function save() {
  void host.tabState.set({ items });
}

function add() {
  if (!draft.trim()) return;
  items.push({
    id: `${Date.now()}-${items.length}`,
    text: draft.trim(),
    done: false,
  });
  draft = "";
  save();
}

function toggle(item: Item) {
  item.done = !item.done;
  save();
}

function remove(item: Item) {
  items = items.filter((other) => other.id !== item.id);
  save();
}
</script>

<PanelView>
  {#snippet banner()}
    <PanelHeader title="Checklist" count={open}>
      {#snippet trailing()}
        <PanelToolbarButton
          icon={Plus}
          label="Add item"
          disabled={!draft.trim()}
          onclick={add}
        />
      {/snippet}
    </PanelHeader>
    <div class={["pt-1", items.length === 0 && "pb-1.5"]}>
      <Input
        placeholder="Add an item"
        aria-label="New item"
        bind:value={draft}
        onkeydown={(event: KeyboardEvent) => {
          if (event.key === "Enter") add();
        }}
      />
      {#if items.length > 0}
        <PanelFilterBar
          bind:query
          bind:scope
          placeholder="Filter items"
          ariaLabel="Filter items"
          scopeLabel="Show"
          scopes={[
            { value: "all", label: "All", count: items.length },
            { value: "open", label: "Open", count: open },
            { value: "done", label: "Done", count: items.length - open },
          ]}
        />
      {/if}
    </div>
  {/snippet}

  {#if items.length === 0}
    <PanelEmpty
      icon={ListChecks}
      title="No items yet"
      description="Add the first item above."
    />
  {:else if shown.length === 0}
    <PanelEmpty title="No matching items" />
  {:else}
    <ScrollArea class="min-h-0 flex-1">
      <PanelList ariaLabel="Checklist items">
        {#each shown as item (item.id)}
          <PanelRow
            label={item.text}
            dimmed={item.done}
            onclick={() => toggle(item)}
            menuItems={[
              {
                label: item.done ? "Mark open" : "Mark done",
                onSelect: () => toggle(item),
              },
              { type: "separator" },
              {
                label: "Delete",
                destructive: true,
                onSelect: () => remove(item),
              },
            ]}
          >
            {#snippet leading()}
              {#if item.done}
                <CircleCheck class="size-3.5 text-success" aria-hidden="true" />
              {:else}
                <Circle
                  class="size-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
              {/if}
            {/snippet}
            {#snippet actions()}
              <PanelToolbarButton
                dense
                icon={Trash2}
                label="Delete item"
                onclick={() => remove(item)}
              />
            {/snippet}
          </PanelRow>
        {/each}
      </PanelList>
    </ScrollArea>
  {/if}
</PanelView>

<script lang="ts">
import { tick } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";

let {
  open = $bindable(false),
  kind,
  parentPath,
  onCreate,
}: {
  open?: boolean;
  kind: "file" | "directory";
  parentPath: string;
  onCreate: (name: string) => Promise<void>;
} = $props();

let name = $state("");
let saving = $state(false);
let error = $state<string>();
let input = $state<HTMLInputElement | null>(null);

const title = $derived(kind === "file" ? "New file" : "New folder");
const valid = $derived(
  name.trim().length > 0 &&
    name.trim() !== "." &&
    name.trim() !== ".." &&
    !/[\\/\0]/.test(name.trim()),
);

$effect(() => {
  if (!open) return;
  name = "";
  error = undefined;
  void tick().then(() => input?.focus());
});

async function submit(event?: SubmitEvent): Promise<void> {
  event?.preventDefault();
  if (!valid || saving) return;
  saving = true;
  error = undefined;
  try {
    await onCreate(name.trim());
    open = false;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    saving = false;
  }
}
</script>

<Dialog
  bind:open
  {title}
  description={`Create an empty ${kind === "file" ? "file" : "folder"} in ${parentPath || "the project root"}.`}
  size="sm"
>
  <form class="grid gap-2" onsubmit={(event) => void submit(event)}>
    <Label for="new-project-entry-name">Name</Label>
    <Input
      id="new-project-entry-name"
      bind:ref={input}
      bind:value={name}
      maxlength={255}
      disabled={saving}
      autocomplete="off"
      placeholder={kind === "file" ? "example.ts" : "folder-name"}
    />
    <p class="text-xs text-muted-foreground">
      Enter one name without path separators.
    </p>
    {#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
  </form>

  {#snippet footer()}
    <Button
      size="sm"
      variant="ghost"
      disabled={saving}
      onclick={() => (open = false)}>Cancel</Button
    >
    <Button size="sm" disabled={!valid || saving} onclick={() => void submit()}>
      {saving ? "Creating…" : `Create ${kind === "file" ? "file" : "folder"}`}
    </Button>
  {/snippet}
</Dialog>

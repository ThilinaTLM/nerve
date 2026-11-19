<script lang="ts">
import { Badge, host } from "@nervekit/extension-sdk/ui";
import { parseCsv } from "./csv";

let rows = $state<string[][]>([]);
let error = $state<string | undefined>();
let loading = $state(true);

async function load() {
  try {
    const info = await host.file.info();
    rows = parseCsv(
      await host.file.text(),
      info.extension === ".tsv" ? "\t" : ",",
    );
    error = undefined;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading = false;
  }
}

// Load now, and again whenever the file changes on disk.
$effect(() => {
  void load();
  return host.onFileChange(() => void load());
});

const header = $derived(rows[0] ?? []);
const body = $derived(rows.slice(1));
</script>

<div class="flex h-screen flex-col bg-background text-foreground">
  {#if error}
    <p class="p-4 text-ui text-destructive">{error}</p>
  {:else if loading}
    <p class="p-4 text-ui text-muted-foreground">Loading…</p>
  {:else if rows.length === 0}
    <p class="p-4 text-ui text-muted-foreground">The file is empty.</p>
  {:else}
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <Badge variant="neutral">{body.length} rows</Badge>
      <Badge variant="neutral">{header.length} columns</Badge>
    </div>
    <div class="min-h-0 flex-1 overflow-auto">
      <table class="w-full border-collapse text-ui">
        <thead class="sticky top-0 bg-card">
          <tr>
            {#each header as cell, index (index)}
              <th
                class="border-b border-border px-3 py-1.5 text-left font-medium"
              >
                {cell}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each body as row, index (index)}
            <tr class="hover:bg-hover">
              {#each row as cell, column (column)}
                <td class="border-b border-border-subtle px-3 py-1.5">{cell}</td
                >
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

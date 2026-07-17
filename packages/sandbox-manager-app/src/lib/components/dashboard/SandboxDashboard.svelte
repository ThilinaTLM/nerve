<script lang="ts">
import Boxes from "@lucide/svelte/icons/boxes";
import Plus from "@lucide/svelte/icons/plus";
import { ConversationSignal } from "@nervekit/workbench-ui";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Search from "@lucide/svelte/icons/search";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { StatusDot } from "@nervekit/ui-kit/components/ui/status-dot";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import SandboxListRow from "../SandboxListRow.svelte";
import SandboxSummaryCards from "../SandboxSummaryCards.svelte";
import { useSandboxCenter } from "../../state/sandbox-center.svelte";
import {
  activityFor,
  filteredSandboxes,
} from "../../state/sandbox-manager-selectors.svelte";
import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";

const store = useSandboxManagerStore();
const center = useSandboxCenter();

const sandboxes = $derived(filteredSandboxes(store));
</script>

<ScrollArea class="h-full">
  <div class="relative mx-auto min-h-full w-full max-w-5xl p-4 sm:p-6">
    <div class="relative z-10 flex flex-col gap-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-lg font-semibold">Sandboxes</h1>
          <p class="text-sm text-muted-foreground">
            Monitor and manage sandbox containers owned by this manager.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onclick={() => void store.refreshFleet()}
          >
            <RefreshCw class="size-4" /> Refresh
          </Button>
          <Button size="sm" onclick={() => (store.createDialogOpen = true)}>
            <Plus class="size-4" /> New sandbox
          </Button>
        </div>
      </div>

      {#if store.connection !== "live"}
        <div
          class="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground"
        >
          <StatusDot tone="running" pulse />
          <span class="capitalize">{store.connection}</span>
          <span>to the sandbox manager…</span>
        </div>
      {/if}

      <SandboxSummaryCards />

      <div class="relative w-full sm:max-w-sm">
        <Search
          class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          bind:value={store.searchQuery}
          placeholder="Search sandboxes…"
          class="pl-8"
          aria-label="Search sandboxes"
        />
      </div>
    </div>

    {#if store.sandboxes.length === 0}
      <div class="absolute inset-0">
        <ConversationSignal
          title="Spin up your first sandbox"
          message="Sandboxes run agents in isolated containers with their own workspace, tools, and credentials."
        >
          {#snippet footer()}
            <Button onclick={() => (store.createDialogOpen = true)}>
              <Plus aria-hidden="true" />
              New sandbox
            </Button>
          {/snippet}
        </ConversationSignal>
      </div>
    {:else if sandboxes.length === 0}
      <div
        class="mt-5 flex flex-col items-center gap-3 rounded-md border border-dashed bg-card py-16 text-center"
      >
        <Boxes class="size-8 text-muted-foreground" />
        <p class="text-sm text-muted-foreground">
          No sandboxes match the current filter.
        </p>
      </div>
    {:else}
      <ul class="mt-5 flex flex-col gap-2">
        {#each sandboxes as record (record.sandboxId)}
          <SandboxListRow
            {record}
            activity={activityFor(store, record.sandboxId)}
            onOpen={() => center.openSandbox(record.sandboxId)}
          />
        {/each}
      </ul>
    {/if}
  </div>
</ScrollArea>

<script lang="ts">
  import {
    MoreHorizontal,
    Play,
    RefreshCw,
    Square,
    Trash2,
  } from "@lucide/svelte";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Button, buttonVariants } from "@nervekit/ui/components/ui/button";
  import * as DropdownMenu from "@nervekit/ui/components/ui/dropdown-menu";
  import { cn } from "@nervekit/ui/core/utils";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import { canRestart, canStart, canStop } from "../state/sandbox-status";
  import SandboxRemoveDialog from "./SandboxRemoveDialog.svelte";

  let {
    record,
    compact = false,
  }: { record: ManagedSandboxRecord; compact?: boolean } = $props();

  const store = useSandboxManagerStore();
  let removeOpen = $state(false);

  function guard(action: Promise<void>) {
    action.catch(() => undefined);
  }
</script>

<div class="inline-flex items-center gap-1">
  {#if !compact}
    <Button
      variant="ghost"
      size="xs"
      disabled={!canStart(record)}
      onclick={() => guard(store.startSandbox(record.sandboxId))}
    >
      <Play class="size-3.5" /> Start
    </Button>
    <Button
      variant="ghost"
      size="xs"
      disabled={!canStop(record)}
      onclick={() => guard(store.stopSandbox(record.sandboxId))}
    >
      <Square class="size-3.5" /> Stop
    </Button>
  {/if}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
      aria-label="Sandbox actions"
    >
      <MoreHorizontal class="size-4" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end">
      <DropdownMenu.Item
        disabled={!canStart(record)}
        onSelect={() => guard(store.startSandbox(record.sandboxId))}
      >
        <Play class="size-4" /> Start
      </DropdownMenu.Item>
      <DropdownMenu.Item
        disabled={!canStop(record)}
        onSelect={() => guard(store.stopSandbox(record.sandboxId))}
      >
        <Square class="size-4" /> Stop
      </DropdownMenu.Item>
      <DropdownMenu.Item
        disabled={!canRestart(record)}
        onSelect={() => guard(store.restartSandbox(record.sandboxId))}
      >
        <RefreshCw class="size-4" /> Restart
      </DropdownMenu.Item>
      <DropdownMenu.Separator />
      <DropdownMenu.Item
        class="text-destructive data-highlighted:text-destructive"
        onSelect={() => {
          removeOpen = true;
        }}
      >
        <Trash2 class="size-4" /> Remove…
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>

<SandboxRemoveDialog bind:open={removeOpen} {record} />

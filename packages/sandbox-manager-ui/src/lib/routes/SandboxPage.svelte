<script lang="ts">
  import {
    ArrowLeft,
    FileClock,
    KeyRound,
    ListTree,
    MessageSquare,
    Terminal,
  } from "@lucide/svelte";
  import { Button } from "@nervekit/ui/components/ui/button";
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
  } from "@nervekit/ui/components/ui/card";
  import TabsBar from "@nervekit/ui/components/ui/tabs-bar";
  import AppShell from "../components/layout/AppShell.svelte";
  import SandboxActionMenu from "../components/SandboxActionMenu.svelte";
  import SandboxStatusBadge from "../components/SandboxStatusBadge.svelte";
  import SandboxBootTimeline from "./SandboxBootTimeline.svelte";
  import SandboxEventsView from "./SandboxEventsView.svelte";
  import SandboxRuntimeView from "./SandboxRuntimeView.svelte";
  import SandboxSecretsView from "./SandboxSecretsView.svelte";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import { observedStateLabel } from "../state/sandbox-status";
  import type { SandboxManagerRouteState } from "./route-state.svelte";

  let {
    route,
    sandboxId,
  }: { route: SandboxManagerRouteState; sandboxId: string } = $props();

  const store = useSandboxManagerStore();
  const record = $derived(
    store.sandboxes.find((item) => item.sandboxId === sandboxId),
  );
  const detail = $derived(store.details[sandboxId]);
  const status = $derived(detail?.status);
  const session = $derived(detail?.latestSession);

  let tab = $state("boot");
  const tabs = [
    { value: "boot", label: "Boot/setup", icon: ListTree },
    { value: "runtime", label: "Runtime/logs", icon: Terminal },
    { value: "secrets", label: "Secrets/config", icon: KeyRound },
    { value: "events", label: "Events", icon: FileClock },
  ];

  $effect(() => {
    if (tab === "runtime" && detail && detail.logsText === "")
      void store.loadLogs(sandboxId);
  });
</script>

<AppShell {route}>
  {#snippet actions()}
    {#if record}
      <Button size="sm" onclick={() => route.openChat(sandboxId)}>
        <MessageSquare class="size-4" /> Open chat
      </Button>
      <SandboxActionMenu {record} compact />
    {/if}
  {/snippet}

  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-center gap-3">
      <Button variant="ghost" size="icon-sm" ariaLabel="Back to fleet" onclick={() => route.fleet()}>
        <ArrowLeft class="size-4" />
      </Button>
      <div class="flex min-w-0 flex-col">
        <h1 class="truncate text-lg font-semibold">
          {record?.name ?? sandboxId}
        </h1>
        <span class="truncate font-mono text-xs text-muted-foreground">{sandboxId}</span>
      </div>
      {#if record}<SandboxStatusBadge {record} />{/if}
    </div>

    {#if !record}
      <div class="rounded-md border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        {detail?.loading ? "Loading sandbox…" : "Sandbox not found."}
      </div>
    {:else}
      <div class="grid gap-4 md:grid-cols-3">
        <Card class="border">
          <CardHeader><CardTitle class="text-sm">Lifecycle</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-2 text-sm">
            <div class="flex justify-between gap-2">
              <span class="text-muted-foreground">Desired</span>
              <span class="capitalize">{record.desiredState}</span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-muted-foreground">Observed</span>
              <span>{observedStateLabel(record.observedState)}</span>
            </div>
            {#if status}
              <div class="flex justify-between gap-2">
                <span class="text-muted-foreground">Daemon</span>
                <span class="capitalize">{status.status}{status.stale ? " (stale)" : ""}</span>
              </div>
            {/if}
          </CardContent>
        </Card>

        <Card class="border">
          <CardHeader><CardTitle class="text-sm">Image</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-2 text-sm">
            <div class="flex flex-col">
              <span class="text-muted-foreground">Reference</span>
              <span class="truncate font-mono text-xs">{record.image.reference}</span>
            </div>
            {#if record.image.runtimeVersion}
              <div class="flex justify-between gap-2">
                <span class="text-muted-foreground">Runtime</span>
                <span class="font-mono text-xs">{record.image.runtimeVersion}</span>
              </div>
            {/if}
          </CardContent>
        </Card>

        <Card class="border">
          <CardHeader><CardTitle class="text-sm">Controller session</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-2 text-sm">
            <div class="flex justify-between gap-2">
              <span class="text-muted-foreground">Status</span>
              <span class="capitalize">{session?.status ?? "—"}</span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-muted-foreground">Connected</span>
              <span>{status?.connected ? "yes" : "no"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {#if record.lastError}
        <p class="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
          {record.lastError.code}: {record.lastError.message}
        </p>
      {/if}

      <Card class="border">
        <CardHeader class="gap-3 border-b">
          <CardTitle class="text-sm">Diagnostics</CardTitle>
          <TabsBar {tabs} bind:value={tab} ariaLabel="Sandbox diagnostics" />
        </CardHeader>
        <CardContent class="p-0">
          <div class="max-h-[28rem] overflow-auto">
            {#if tab === "boot"}
              <SandboxBootTimeline {record} />
            {:else if tab === "runtime"}
              <SandboxRuntimeView {record} />
            {:else if tab === "secrets"}
              <SandboxSecretsView {record} />
            {:else if tab === "events"}
              <SandboxEventsView {record} />
            {/if}
          </div>
        </CardContent>
      </Card>
    {/if}
  </div>
</AppShell>

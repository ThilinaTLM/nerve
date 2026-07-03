<script lang="ts">
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { Separator } from "$lib/components/ui/separator";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import { observedStateLabel } from "../state/sandbox-status";

  let { record }: { record: ManagedSandboxRecord } = $props();

  const store = useSandboxManagerStore();
  const detail = $derived(store.details[record.sandboxId]);
  const status = $derived(detail?.status);

  const mounts = $derived(
    [
      { label: "Workspace", ref: record.workspaceRef },
      { label: "State", ref: record.stateRef },
      { label: "Config", ref: record.configRef },
      ...(record.secretMountRefs ?? []).map((ref) => ({
        label: "Secret mount",
        ref,
      })),
    ].filter((entry) => entry.ref),
  );
</script>

<ScrollArea class="h-full">
  <div class="grid gap-4 p-4 lg:grid-cols-2">
    <Card class="border">
      <CardHeader><CardTitle class="text-sm">Identity</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-2 text-sm">
        <div class="flex justify-between gap-2">
          <span class="text-muted-foreground">Name</span>
          <span class="truncate">{record.name ?? "—"}</span>
        </div>
        <div class="flex justify-between gap-2">
          <span class="text-muted-foreground">Sandbox ID</span>
          <span class="truncate font-mono text-xs">{record.sandboxId}</span>
        </div>
        {#if record.instanceId}
          <div class="flex justify-between gap-2">
            <span class="text-muted-foreground">Instance</span>
            <span class="truncate font-mono text-xs">{record.instanceId}</span>
          </div>
        {/if}
        {#if record.labels && Object.keys(record.labels).length > 0}
          <Separator />
          <div class="flex flex-wrap gap-1.5">
            {#each Object.entries(record.labels) as [key, value] (key)}
              <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {key}={value}
              </span>
            {/each}
          </div>
        {/if}
      </CardContent>
    </Card>

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
        {#if record.lastError}
          <p class="rounded bg-destructive/10 p-2 text-xs text-destructive">
            {record.lastError.code}: {record.lastError.message}
          </p>
        {/if}
      </CardContent>
    </Card>

    <Card class="border">
      <CardHeader><CardTitle class="text-sm">Image &amp; config</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-2 text-sm">
        <div class="flex justify-between gap-2">
          <span class="text-muted-foreground">Reference</span>
          <span class="truncate font-mono text-xs">{record.image.reference}</span>
        </div>
        {#if record.image.digest}
          <div class="flex justify-between gap-2">
            <span class="text-muted-foreground">Digest</span>
            <span class="truncate font-mono text-xs">{record.image.digest}</span>
          </div>
        {/if}
        {#if record.image.runtimeVersion}
          <div class="flex justify-between gap-2">
            <span class="text-muted-foreground">Runtime</span>
            <span class="font-mono text-xs">{record.image.runtimeVersion}</span>
          </div>
        {/if}
        {#if record.configDigest}
          <div class="flex justify-between gap-2">
            <span class="text-muted-foreground">Config digest</span>
            <span class="truncate font-mono text-xs">{record.configDigest}</span>
          </div>
        {/if}
      </CardContent>
    </Card>

    <Card class="border">
      <CardHeader><CardTitle class="text-sm">Volumes</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-2 text-sm">
        {#each mounts as mount (mount.label + mount.ref?.target)}
          <div class="flex flex-col">
            <span class="text-muted-foreground">{mount.label}</span>
            <span class="truncate font-mono text-xs">
              {mount.ref?.target}{mount.ref?.readonly ? " (ro)" : ""}
            </span>
          </div>
        {/each}
      </CardContent>
    </Card>

    {#if detail?.latestSession}
      <Card class="border">
        <CardHeader><CardTitle class="text-sm">Controller session</CardTitle></CardHeader>
        <CardContent class="flex flex-col gap-2 text-sm">
          <div class="flex justify-between gap-2">
            <span class="text-muted-foreground">Status</span>
            <span class="capitalize">{detail.latestSession.status ?? "—"}</span>
          </div>
          {#if detail.latestSession.acceptedCapabilities?.length}
            <div class="flex flex-wrap gap-1">
              {#each detail.latestSession.acceptedCapabilities as capability (capability)}
                <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {capability}
                </span>
              {/each}
            </div>
          {/if}
        </CardContent>
      </Card>
    {/if}
  </div>
</ScrollArea>

<script lang="ts">
  import { ShieldCheck } from "@lucide/svelte";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Card, CardContent, CardHeader, CardTitle } from "@nervekit/ui/components/ui/card";
  import { ScrollArea } from "@nervekit/ui/components/ui/scroll-area";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";

  let { record }: { record: ManagedSandboxRecord } = $props();

  const store = useSandboxManagerStore();
  const status = $derived(store.details[record.sandboxId]?.status);
  const secretStores = $derived(status?.secretStores ?? []);
  const credentials = $derived(status?.credentials ?? []);
</script>

<ScrollArea class="h-full">
  <div class="flex flex-col gap-4 p-4">
    <p class="flex items-center gap-2 text-xs text-muted-foreground">
      <ShieldCheck class="size-4" />
      Only metadata is shown here. Secret values and protected paths are never fetched.
    </p>

    <Card class="border">
      <CardHeader><CardTitle class="text-sm">Secret stores</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-2 text-sm">
        {#if secretStores.length === 0}
          <p class="text-muted-foreground">No secret stores reported.</p>
        {:else}
          {#each secretStores as store_ (store_.id)}
            <div class="flex items-center justify-between gap-2">
              <span class="font-mono text-xs">{store_.id}</span>
              <div class="flex items-center gap-1.5">
                {#if store_.cacheEnabled}<Badge tone="neutral" size="xs">cache</Badge>{/if}
                <Badge
                  tone={store_.status === "available" ? "good" : "warn"}
                  size="xs"
                >
                  {store_.status}
                </Badge>
              </div>
            </div>
          {/each}
        {/if}
      </CardContent>
    </Card>

    <Card class="border">
      <CardHeader><CardTitle class="text-sm">Credentials</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-2 text-sm">
        {#if credentials.length === 0}
          <p class="text-muted-foreground">No credential status reported.</p>
        {:else}
          {#each credentials as credential (credential.provider + credential.credentialType)}
            <div class="flex items-center justify-between gap-2">
              <div class="flex min-w-0 flex-col">
                <span class="truncate">{credential.provider}</span>
                <span class="text-xs text-muted-foreground">
                  {credential.credentialType}{credential.expiresAt
                    ? ` · expires ${credential.expiresAt}`
                    : ""}
                </span>
              </div>
              <Badge
                tone={credential.status === "available" ? "good" : "warn"}
                size="xs"
              >
                {credential.status}
              </Badge>
            </div>
          {/each}
        {/if}
      </CardContent>
    </Card>
  </div>
</ScrollArea>

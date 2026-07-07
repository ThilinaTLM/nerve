<script lang="ts">
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import {
    Card,
    CardContent,
  } from "@nervekit/ui/components/ui/card";
  import type {
    SettingsDomain,
    SettingsDomainId,
  } from "../../settings/provider-catalog";

  let {
    domains,
    activeDomainId,
    countForDomain,
    onselect,
  }: {
    domains: SettingsDomain[];
    activeDomainId: SettingsDomainId;
    countForDomain: (domain: SettingsDomain) => number | undefined;
    onselect: (domainId: SettingsDomainId) => void;
  } = $props();
</script>

<Card class="border">
  <CardContent class="grid gap-1 p-2">
    {#each domains as domain (domain.id)}
      {@const Icon = domain.icon}
      {@const count = countForDomain(domain)}
      {@const active = activeDomainId === domain.id}
      {#if domain.id === "appearance"}
        <div class="my-1 border-t" aria-hidden="true"></div>
      {/if}
      <Button
        variant={active ? "secondary" : "ghost"}
        {active}
        aria-current={active ? "page" : undefined}
        onclick={() => onselect(domain.id)}
        class="h-auto w-full justify-start gap-3 px-3 py-3 text-left"
      >
        <span class="rounded-md bg-muted p-2 text-muted-foreground">
          <Icon class="size-4" />
        </span>
        <span class="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span class="truncate text-sm font-medium">{domain.label}</span>
          {#if count !== undefined}
            <Badge tone={count > 0 ? "accent" : "neutral"} size="xs">
              {count}
            </Badge>
          {/if}
        </span>
      </Button>
    {/each}
  </CardContent>
</Card>

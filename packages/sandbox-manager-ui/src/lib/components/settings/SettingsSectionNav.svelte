<script lang="ts">
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { cn } from "@nervekit/ui/core/utils";
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

<nav
  class="rounded-lg border bg-sidebar p-2 text-sidebar-foreground shadow-sm"
  aria-label="Settings sections"
>
  <div class="grid gap-1">
    {#each domains as domain (domain.id)}
      {@const Icon = domain.icon}
      {@const count = countForDomain(domain)}
      {@const active = activeDomainId === domain.id}
      <Button
        variant={active ? "secondary" : "ghost"}
        {active}
        aria-current={active ? "page" : undefined}
        onclick={() => onselect(domain.id)}
        class="h-auto w-full justify-start gap-3 px-3 py-3 text-left"
      >
        <span
          class={cn(
            "rounded-md p-2",
            active ? "bg-background text-primary" : "bg-sidebar-accent text-muted-foreground",
          )}
        >
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
  </div>
</nav>

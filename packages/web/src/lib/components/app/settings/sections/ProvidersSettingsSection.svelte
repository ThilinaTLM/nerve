<script lang="ts">
  import KeyRound from "@lucide/svelte/icons/key-round";
  import type { AuthProviderMetadata } from "../../../../api";
  import { Badge } from "$lib/components/ui/badge";
  import * as Card from "$lib/components/ui/card";

  type Props = {
    authProviders?: AuthProviderMetadata[];
  };

  let { authProviders = [] }: Props = $props();

  function providerCommand(provider: AuthProviderMetadata): string {
    if (provider.supportsOAuth) return `nerve auth login ${provider.provider}`;
    if (provider.supportsApiKey) return `nerve auth set ${provider.provider}`;
    return "nerve auth list";
  }

  function providerBadge(provider: AuthProviderMetadata): string {
    if (!provider.configured) return "inactive";
    if (provider.credentialType === "oauth") return "oauth";
    if (provider.credentialType === "api_key") return "api key";
    return "active";
  }
</script>

<Card.Root size="sm" data-section="providers">
  <Card.Header>
    <Card.Title class="flex items-center gap-2">
      <KeyRound size={16} strokeWidth={2.2} /> Credential status
    </Card.Title>
    <Card.Description>Credentials are managed from the CLI only. Raw secrets are never rendered in the browser.</Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-3">
    {#if authProviders.length === 0}
      <p class="muted">No provider metadata available. Use <code>nerve auth list</code> in the CLI.</p>
    {:else}
      <div class="provider-list">
      {#each authProviders as provider}
        <article class="provider-row app-surface">
          <div>
            <strong>{provider.displayName}</strong>
            <small>{provider.provider}{provider.envVar ? ` · ${provider.envVar}` : ""}</small>
          </div>
          <Badge size="xs" tone={provider.configured ? "good" : "neutral"}>{providerBadge(provider)}</Badge>
          {#if provider.warning}<p>{provider.warning}</p>{/if}
          <code>{provider.configured ? "nerve auth list" : providerCommand(provider)}</code>
        </article>
      {/each}
      </div>
    {/if}
  </Card.Content>
</Card.Root>

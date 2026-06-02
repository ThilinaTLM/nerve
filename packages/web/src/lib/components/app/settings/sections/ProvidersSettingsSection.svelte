<script lang="ts">
  import KeyRound from "lucide-svelte/icons/key-round";
  import type { AuthProviderMetadata } from "../../../../api";
  import Badge from "../../../ui/Badge.svelte";

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

<section class="settings-card" data-section="providers">
  <div class="card-head">
    <div class="card-icon"><KeyRound size={16} strokeWidth={2.2} /></div>
    <div>
      <span class="eyebrow">Providers</span>
      <h2>Credential status</h2>
      <p>Credentials are managed from the CLI only. Raw secrets are never rendered in the browser.</p>
    </div>
  </div>
  {#if authProviders.length === 0}
    <p class="muted">No provider metadata available. Use <code>nerve auth list</code> in the CLI.</p>
  {:else}
    <div class="provider-list">
      {#each authProviders as provider}
        <article class="provider-row">
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
</section>

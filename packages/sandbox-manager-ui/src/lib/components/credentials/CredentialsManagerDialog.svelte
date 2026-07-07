<script lang="ts">
  import { CheckCircle2, Clock, KeyRound, RefreshCw, ShieldCheck, TriangleAlert } from "@lucide/svelte";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "@nervekit/ui/components/ui/card";
  import DialogShell from "@nervekit/ui/components/ui/dialog-shell";
  import { Input } from "@nervekit/ui/components/ui/input";
  import { Label } from "@nervekit/ui/components/ui/label";
  import SelectField from "@nervekit/ui/components/ui/select-field";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const store = useSandboxManagerStore();
  let displayName = $state("");
  let providerKind = $state("anthropic_api_key");
  let secretValue = $state("");
  let siteUrl = $state("");
  let email = $state("");
  let defaultModel = $state("");
  let error = $state<string | undefined>(undefined);
  let busy = $state(false);

  const providerItems = [
    { value: "anthropic_api_key", label: "Anthropic API key", detail: "Claude API" },
    { value: "anthropic_oauth", label: "Anthropic subscription", detail: "OAuth bundle import; manager refreshes" },
    { value: "openai_api_key", label: "OpenAI API key" },
    { value: "openai_codex_oauth", label: "OpenAI Codex subscription", detail: "OAuth bundle import; manager refreshes" },
    { value: "google_api_key", label: "Google API key" },
    { value: "xai_api_key", label: "xAI API key" },
    { value: "openrouter_api_key", label: "OpenRouter API key" },
    { value: "github_pat", label: "GitHub token", detail: "Manual rotation" },
    { value: "github_app", label: "GitHub App", detail: "Installation token renewal" },
    { value: "jira_api_token", label: "Jira API token" },
    { value: "confluence_api_token", label: "Confluence API token" },
    { value: "tavily_api_key", label: "Tavily API key" },
  ];

  const selectedKind = $derived(providerItems.find((item) => item.value === providerKind));
  const isOAuth = $derived(providerKind.endsWith("_oauth"));
  const isJira = $derived(providerKind.startsWith("jira"));
  const isConfluence = $derived(providerKind.startsWith("confluence"));
  const needsSite = $derived(isJira || isConfluence);

  function profileKindForProvider() {
    if (providerKind.startsWith("github")) return "github";
    if (providerKind.startsWith("jira")) return "jira";
    if (providerKind.startsWith("confluence")) return "confluence";
    if (providerKind === "tavily_api_key") return "web_provider";
    return "model_provider";
  }

  function providerForKind() {
    if (providerKind.startsWith("anthropic")) return "anthropic";
    if (providerKind.startsWith("openai_codex")) return "openai-codex";
    if (providerKind.startsWith("openai")) return "openai";
    if (providerKind.startsWith("google")) return "google";
    if (providerKind.startsWith("xai")) return "xai";
    if (providerKind.startsWith("openrouter")) return "openrouter";
    if (providerKind.startsWith("github")) return "github.com";
    if (providerKind.startsWith("jira")) return "jira";
    if (providerKind.startsWith("confluence")) return "confluence";
    if (providerKind === "tavily_api_key") return "tavily";
    return providerKind;
  }

  async function saveProfile() {
    busy = true;
    error = undefined;
    try {
      const oauthImport = isOAuth ? JSON.parse(secretValue || "{}") : undefined;
      await store.createCredentialProfile({
        kind: profileKindForProvider() as never,
        providerKind: providerKind as never,
        displayName: displayName || selectedKind?.label || providerKind,
        provider: providerForKind(),
        siteUrl: siteUrl || undefined,
        email: email || undefined,
        defaultModel: defaultModel || undefined,
        apiKey: !isOAuth && !providerKind.includes("github_app") ? secretValue || undefined : undefined,
        oauthImport,
      });
      displayName = "";
      secretValue = "";
    } catch (saveError) {
      error = saveError instanceof Error ? saveError.message : String(saveError);
    } finally {
      busy = false;
    }
  }
</script>

<DialogShell
  bind:open
  title="Credential control center"
  description="Connect provider auth once. The manager stores secrets encrypted, refreshes OAuth before expiry, and gives sandboxes only current scoped credentials."
>
  <div class="flex max-h-svh flex-col gap-4 overflow-y-auto p-5">
    <div class="grid gap-3 md:grid-cols-3">
      <Card class="rounded-md border">
        <CardContent class="flex items-center gap-3 p-4">
          <ShieldCheck class="size-5 text-success" />
          <div>
            <p class="text-sm font-medium">Manager-owned</p>
            <p class="text-xs text-muted-foreground">No raw secrets in UI or sandbox config.</p>
          </div>
        </CardContent>
      </Card>
      <Card class="rounded-md border">
        <CardContent class="flex items-center gap-3 p-4">
          <RefreshCw class="size-5 text-info" />
          <div>
            <p class="text-sm font-medium">Refresh-aware</p>
            <p class="text-xs text-muted-foreground">OAuth profiles renew before expiry.</p>
          </div>
        </CardContent>
      </Card>
      <Card class="rounded-md border">
        <CardContent class="flex items-center gap-3 p-4">
          <Clock class="size-5 text-warning" />
          <div>
            <p class="text-sm font-medium">Expiry tracked</p>
            <p class="text-xs text-muted-foreground">Sandboxes cache only until manager deadlines.</p>
          </div>
        </CardContent>
      </Card>
    </div>

    <Card class="rounded-md border">
      <CardHeader><CardTitle class="text-sm">Add provider authentication</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-3">
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <Label>Provider auth type</Label>
            <SelectField items={providerItems} value={providerKind} onValueChange={(value) => (providerKind = value)} />
          </div>
          <div class="flex flex-col gap-1">
            <Label>Display name</Label>
            <Input bind:value={displayName} placeholder={selectedKind?.label ?? "Production provider"} />
          </div>
          {#if needsSite}
            <div class="flex flex-col gap-1">
              <Label>Site URL</Label>
              <Input bind:value={siteUrl} placeholder="https://example.atlassian.net" />
            </div>
            <div class="flex flex-col gap-1">
              <Label>Email</Label>
              <Input bind:value={email} placeholder="you@example.com" />
            </div>
          {/if}
          <div class="flex flex-col gap-1">
            <Label>{isOAuth ? "OAuth bundle JSON" : "Secret value"}</Label>
            <Input bind:value={secretValue} type="password" placeholder={isOAuth ? '{"accessToken":"...","refreshToken":"...","expiresAt":"..."}' : "write-only"} />
          </div>
          {#if profileKindForProvider() === "model_provider"}
            <div class="flex flex-col gap-1">
              <Label>Default model hint</Label>
              <Input bind:value={defaultModel} placeholder="claude-sonnet-4-5" />
            </div>
          {/if}
        </div>
        <Button size="sm" disabled={busy || !secretValue} onclick={saveProfile}>
          <KeyRound class="size-4" /> Save managed profile
        </Button>
      </CardContent>
    </Card>

    <Card class="rounded-md border">
      <CardHeader><CardTitle class="text-sm">Managed profiles</CardTitle></CardHeader>
      <CardContent class="grid gap-2 text-sm md:grid-cols-2">
        {#if store.credentialProfiles.length === 0}
          <p class="text-muted-foreground">No credential profiles yet.</p>
        {:else}
          {#each store.credentialProfiles as profile (profile.profileId)}
            <div class="flex items-start justify-between gap-3 rounded-md border bg-card px-3 py-2.5">
              <div class="min-w-0">
                <p class="truncate font-medium">{profile.displayName}</p>
                <p class="truncate text-xs text-muted-foreground">
                  {profile.providerKind} · {profile.authType}
                </p>
                {#if profile.expiresAt}
                  <p class="truncate text-xs text-muted-foreground">expires {profile.expiresAt}</p>
                {/if}
              </div>
              <Badge tone={profile.status === "configured" ? "good" : "warn"} size="xs">
                {profile.status}
              </Badge>
            </div>
          {/each}
        {/if}
      </CardContent>
    </Card>

    {#if error}
      <p class="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
        <TriangleAlert class="mt-0.5 size-4 flex-none" />
        {error}
      </p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" size="sm" onclick={() => (open = false)}>Close</Button>
  {/snippet}
</DialogShell>

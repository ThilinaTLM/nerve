<script lang="ts">
  import { KeyRound, TriangleAlert } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import DialogShell from "$lib/components/ui/dialog-shell";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import SelectField from "$lib/components/ui/select-field";
  import { Textarea } from "$lib/components/ui/textarea";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const store = useSandboxManagerStore();
  let secretKey = $state("");
  let secretValue = $state("");
  let profileName = $state("");
  let profileKind = $state("model_provider");
  let provider = $state("anthropic");
  let credentialJson = $state('{"type":"api_key","apiKey":{"kv":{"key":""}}}');
  let error = $state<string | undefined>(undefined);
  let busy = $state(false);

  const kindItems = [
    { value: "model_provider", label: "Model provider" },
    { value: "github", label: "GitHub" },
    { value: "jira", label: "Jira" },
    { value: "confluence", label: "Confluence" },
    { value: "web_provider", label: "Web provider" },
  ];

  async function saveSecret() {
    busy = true;
    error = undefined;
    try {
      await store.writeSecret({ key: secretKey, value: secretValue });
      secretValue = "";
    } catch (saveError) {
      error = saveError instanceof Error ? saveError.message : String(saveError);
    } finally {
      busy = false;
    }
  }

  async function saveProfile() {
    busy = true;
    error = undefined;
    try {
      await store.createCredentialProfile({
        kind: profileKind as never,
        displayName: profileName,
        provider: provider || undefined,
        credential: JSON.parse(credentialJson || "{}"),
      });
      profileName = "";
    } catch (saveError) {
      error = saveError instanceof Error ? saveError.message : String(saveError);
    } finally {
      busy = false;
    }
  }
</script>

<DialogShell
  bind:open
  title="Manager credentials"
  description="Store encrypted manager secrets and reusable auth profiles. Secret values are write-only."
>
  <div class="flex max-h-svh flex-col gap-4 overflow-y-auto p-5">
    <Card class="border">
      <CardHeader><CardTitle class="text-sm">Secret value</CardTitle></CardHeader>
      <CardContent class="grid gap-3 sm:grid-cols-2">
        <div class="flex flex-col gap-1">
          <Label>Secret key</Label>
          <Input bind:value={secretKey} placeholder="credentials/anthropic/api-key" />
        </div>
        <div class="flex flex-col gap-1">
          <Label>Secret value</Label>
          <Input bind:value={secretValue} type="password" placeholder="write-only" />
        </div>
        <div class="sm:col-span-2">
          <Button size="sm" disabled={busy || !secretKey || !secretValue} onclick={saveSecret}>
            Save encrypted secret
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card class="border">
      <CardHeader><CardTitle class="text-sm">Credential profile</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-3">
        <div class="grid gap-3 sm:grid-cols-3">
          <div class="flex flex-col gap-1">
            <Label>Name</Label>
            <Input bind:value={profileName} placeholder="Anthropic production" />
          </div>
          <div class="flex flex-col gap-1">
            <Label>Kind</Label>
            <SelectField
              items={kindItems}
              value={profileKind}
              onValueChange={(value) => (profileKind = value)}
            />
          </div>
          <div class="flex flex-col gap-1">
            <Label>Provider / host</Label>
            <Input bind:value={provider} placeholder="anthropic, github.com, tavily" />
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <Label>Credential JSON using SecretRef</Label>
          <Textarea bind:value={credentialJson} class="min-h-24 font-mono text-xs" />
        </div>
        <Button size="sm" disabled={busy || !profileName} onclick={saveProfile}>
          <KeyRound class="size-4" /> Save profile
        </Button>
      </CardContent>
    </Card>

    <Card class="border">
      <CardHeader><CardTitle class="text-sm">Saved profiles</CardTitle></CardHeader>
      <CardContent class="flex flex-col gap-2 text-sm">
        {#if store.credentialProfiles.length === 0}
          <p class="text-muted-foreground">No credential profiles yet.</p>
        {:else}
          {#each store.credentialProfiles as profile (profile.profileId)}
            <div class="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div class="min-w-0">
                <p class="truncate font-medium">{profile.displayName}</p>
                <p class="truncate text-xs text-muted-foreground">
                  {profile.kind}{profile.provider ? ` · ${profile.provider}` : ""}
                </p>
              </div>
              <span class="font-mono text-xs text-muted-foreground">{profile.profileId}</span>
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

<script lang="ts">
  import { TriangleAlert } from "@lucide/svelte";
  import { Button } from "@nervekit/ui/components/ui/button";
  import DialogShell from "@nervekit/ui/components/ui/dialog-shell";
  import { Input } from "@nervekit/ui/components/ui/input";
  import { Label } from "@nervekit/ui/components/ui/label";
  import SelectField from "@nervekit/ui/components/ui/select-field";
  import { Separator } from "@nervekit/ui/components/ui/separator";
  import SwitchField from "@nervekit/ui/components/ui/switch-field";
  import { Textarea } from "@nervekit/ui/components/ui/textarea";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import {
    buildCreateRequest,
    CREATE_SANDBOX_TOOL_KEYS,
    createDefaultDraft,
  } from "../../state/create-sandbox-draft";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const store = useSandboxManagerStore();
  let draft = $state(createDefaultDraft());
  let error = $state<string | undefined>(undefined);
  let busy = $state(false);

  const modeItems = [
    { value: "normal", label: "Normal" },
    { value: "planning", label: "Planning" },
  ];
  const permissionItems = [
    { value: "read_only", label: "Read-only" },
    { value: "supervised", label: "Supervised" },
    { value: "autonomous", label: "Autonomous" },
  ];
  const noneProfile = { value: "", label: "None" };
  const modelProfileItems = $derived([
    noneProfile,
    ...store.credentialProfiles
      .filter((profile) => profile.kind === "model_provider")
      .map((profile) => ({
        value: profile.profileId,
        label: profile.displayName,
        detail: profile.provider,
      })),
  ]);
  const githubProfileItems = $derived([
    noneProfile,
    ...store.credentialProfiles
      .filter((profile) => profile.kind === "github")
      .map((profile) => ({ value: profile.profileId, label: profile.displayName })),
  ]);
  const jiraProfileItems = $derived([
    noneProfile,
    ...store.credentialProfiles
      .filter((profile) => profile.kind === "jira")
      .map((profile) => ({ value: profile.profileId, label: profile.displayName })),
  ]);
  const confluenceProfileItems = $derived([
    noneProfile,
    ...store.credentialProfiles
      .filter((profile) => profile.kind === "confluence")
      .map((profile) => ({ value: profile.profileId, label: profile.displayName })),
  ]);
  const webProfileItems = $derived([
    noneProfile,
    ...store.credentialProfiles
      .filter((profile) => profile.kind === "web_provider")
      .map((profile) => ({ value: profile.profileId, label: profile.displayName })),
  ]);

  function reset() {
    draft = createDefaultDraft();
    error = undefined;
  }

  async function submit() {
    const result = buildCreateRequest(draft);
    if (!result.ok) {
      error = result.error;
      return;
    }
    error = undefined;
    busy = true;
    try {
      const sandboxId = await store.createSandbox(result.request);
      await store.selectSandbox(sandboxId);
      open = false;
      reset();
    } catch (submitError) {
      error =
        submitError instanceof Error ? submitError.message : String(submitError);
    } finally {
      busy = false;
    }
  }
</script>

<DialogShell
  bind:open
  title="Create sandbox"
  description="Configure a new sandbox. The manager owns controller wiring for you."
  onOpenChange={(next) => {
    if (!next) reset();
  }}
>
  <div class="flex flex-col gap-5 p-5">
    <section class="flex flex-col gap-3">
      <h3 class="text-xs font-semibold text-muted-foreground uppercase">Identity</h3>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="flex flex-col gap-1">
          <Label>Display name</Label>
          <Input bind:value={draft.name} placeholder="my-sandbox" />
        </div>
        <div class="flex flex-col gap-1">
          <Label>Sandbox ID (optional)</Label>
          <Input bind:value={draft.sandboxId} placeholder="auto-generated" />
        </div>
        <div class="flex flex-col gap-1">
          <Label>Image</Label>
          <Input bind:value={draft.image} />
        </div>
        <div class="flex flex-col gap-1">
          <Label>Labels</Label>
          <Input bind:value={draft.labels} placeholder="team=core, env=dev" />
        </div>
      </div>
      <div class="rounded-md border bg-card px-3 py-2.5">
        <SwitchField
          checked={draft.startAfterCreate}
          label="Start after create"
          onCheckedChange={(value) => (draft.startAfterCreate = value)}
        />
      </div>
    </section>

    <Separator />

    {#if !draft.useAdvancedConfig}
      <section class="flex flex-col gap-3">
        <h3 class="text-xs font-semibold text-muted-foreground uppercase">Agent &amp; model</h3>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <Label>Main provider</Label>
            <Input bind:value={draft.mainProvider} />
          </div>
          <div class="flex flex-col gap-1">
            <Label>Main model</Label>
            <Input bind:value={draft.mainModel} />
          </div>
          <div class="flex flex-col gap-1">
            <Label>Mode</Label>
            <SelectField
              items={modeItems}
              value={draft.mode}
              onValueChange={(value) =>
                (draft.mode = value as typeof draft.mode)}
            />
          </div>
          <div class="flex flex-col gap-1">
            <Label>Permission level</Label>
            <SelectField
              items={permissionItems}
              value={draft.permissionLevel}
              onValueChange={(value) =>
                (draft.permissionLevel = value as typeof draft.permissionLevel)}
            />
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <Label>Initial prompt (optional)</Label>
          <Textarea bind:value={draft.initialPrompt} class="min-h-16" />
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <h3 class="text-xs font-semibold text-muted-foreground uppercase">Authentication</h3>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <Label>Main model profile</Label>
            <SelectField
              items={modelProfileItems}
              value={draft.mainModelProfileId}
              placeholder="No profile"
              onValueChange={(value) => (draft.mainModelProfileId = value)}
            />
          </div>
          <div class="flex flex-col gap-1">
            <Label>GitHub profile</Label>
            <SelectField
              items={githubProfileItems}
              value={draft.githubProfileId}
              placeholder="No profile"
              onValueChange={(value) => (draft.githubProfileId = value)}
            />
          </div>
          <div class="flex flex-col gap-1">
            <Label>Jira profile</Label>
            <SelectField
              items={jiraProfileItems}
              value={draft.jiraProfileId}
              placeholder="No profile"
              onValueChange={(value) => {
                draft.jiraProfileId = value;
                if (value) draft.tools.jira = true;
              }}
            />
          </div>
          <div class="flex flex-col gap-1">
            <Label>Confluence profile</Label>
            <SelectField
              items={confluenceProfileItems}
              value={draft.confluenceProfileId}
              placeholder="No profile"
              onValueChange={(value) => {
                draft.confluenceProfileId = value;
                if (value) draft.tools.confluence = true;
              }}
            />
          </div>
          <div class="flex flex-col gap-1">
            <Label>Web provider profile</Label>
            <SelectField
              items={webProfileItems}
              value={draft.webProfileId}
              placeholder="No profile"
              onValueChange={(value) => {
                draft.webProfileId = value;
                if (value) draft.tools.web = true;
              }}
            />
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold text-muted-foreground uppercase">Tools</h3>
        <div class="grid gap-2 sm:grid-cols-2">
          {#each CREATE_SANDBOX_TOOL_KEYS as tool (tool)}
            <div class="rounded-md border bg-card px-3 py-2">
              <SwitchField
                checked={draft.tools[tool]}
                label={tool}
                onCheckedChange={(value) => (draft.tools[tool] = value)}
              />
            </div>
          {/each}
        </div>
      </section>
    {:else}
      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold text-muted-foreground uppercase">
          Advanced config (JSON)
        </h3>
        <Textarea
          bind:value={draft.advancedConfig}
          class="min-h-48 font-mono text-xs"
          placeholder={'{\n  "version": 1,\n  "agent": { "mainModel": { "provider": "anthropic", "model": "claude-sonnet-4-5" } }\n}'}
        />
        <p class="text-xs text-muted-foreground">
          Controller config is manager-owned and optional; omit it here.
        </p>
      </section>
    {/if}

    <Separator />

    <div class="rounded-md border bg-card px-3 py-2.5">
      <SwitchField
        checked={draft.useAdvancedConfig}
        label="Advanced JSON config"
        description="Edit the raw create-config input instead of the form."
        onCheckedChange={(value) => (draft.useAdvancedConfig = value)}
      />
    </div>

    {#if error}
      <p class="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
        <TriangleAlert class="mt-0.5 size-4 flex-none" />
        {error}
      </p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" size="sm" disabled={busy} onclick={() => (open = false)}>
      Cancel
    </Button>
    <Button size="sm" disabled={busy} onclick={submit}>Create sandbox</Button>
  {/snippet}
</DialogShell>

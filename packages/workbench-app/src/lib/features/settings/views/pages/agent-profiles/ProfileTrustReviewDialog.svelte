<!-- Per-file review of a project profile. Trust applies to this exact version of the file. -->
<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import type { ProfileCatalogEntry } from "@nervekit/contracts/agent-configuration";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";

type Props = {
  open?: boolean;
  profile?: ProfileCatalogEntry;
  /** One readable line per setting, built by the page. */
  lines: { label: string; value: string }[];
  busy?: boolean;
  error?: string;
  onTrust: () => void | Promise<void>;
};
let {
  open = $bindable(false),
  profile,
  lines,
  busy = false,
  error,
  onTrust,
}: Props = $props();
const file = $derived(profile?.definition);
</script>

<Dialog
  bind:open
  size="md"
  title="Review project profile"
  description={profile?.path}
>
  <div class="grid gap-3">
    <Callout
      layout="block"
      tone="warning"
      text="Trust applies to this exact version of the file. A later edit asks again. Untrusted profiles aren't applied."
    />
    {#if file}
      <div class="grid divide-y divide-border rounded-lg border">
        <div class="flex flex-wrap items-center gap-2 px-3 py-2">
          <span class="text-ui font-medium text-foreground"
            >{file.label ?? file.name}</span
          >
          <Badge variant="info">Project file</Badge>
          <span class="text-ui text-muted-foreground"
            >Usable by {file.usableBy === "lead"
              ? "main agent"
              : file.usableBy === "subagent"
                ? "sub-agents"
                : "main agent and sub-agents"}</span
          >
        </div>
        {#each lines as line (line.label)}
          <div class="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 px-3 py-1.5">
            <span class="text-ui text-muted-foreground">{line.label}</span>
            <span
              class="max-h-40 overflow-auto text-body break-words whitespace-pre-wrap text-foreground"
              >{line.value}</span
            >
          </div>
        {/each}
      </div>
    {/if}
    {#if profile}<Textarea
        readonly
        rows={8}
        class="font-mono"
        aria-label="Reviewed profile definition"
        value={JSON.stringify(profile.definition, null, 2)}
      />
      <p class="text-ui text-muted-foreground font-mono">
        {profile.digest}
      </p>{/if}
    {#if error}<p class="text-ui text-destructive" role="alert">{error}</p>{/if}
  </div>
  {#snippet footer()}
    <Button variant="ghost" disabled={busy} onclick={() => (open = false)}
      >Not now</Button
    >
    <Button disabled={busy || !profile?.digest} onclick={onTrust}
      >{profile?.trusted ? "Revoke trust" : "Trust this version"}</Button
    >
  {/snippet}
</Dialog>

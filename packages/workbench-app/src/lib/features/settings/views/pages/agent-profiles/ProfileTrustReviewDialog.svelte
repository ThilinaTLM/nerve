<!-- Per-file review of a project profile. Trust applies to this exact version of the file. -->
<script lang="ts">
import type { AgentProfileConfiguration } from "@nervekit/contracts/agent-profiles";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { SettingsInlineMessage } from "$lib/presentation/settings";

type Props = {
  open?: boolean;
  profile?: AgentProfileConfiguration;
  /** One readable line per setting, built by the page. */
  lines: { label: string; value: string }[];
  busy?: boolean;
  error?: string;
  onTrust: () => void;
};
let {
  open = $bindable(false),
  profile,
  lines,
  busy = false,
  error,
  onTrust,
}: Props = $props();
const file = $derived(profile?.local);
</script>

<Dialog
  bind:open
  size="md"
  title="Review project profile"
  description={profile?.path}
>
  <div class="grid gap-3">
    <SettingsInlineMessage
      tone="warning"
      text="Trust applies to this exact version of the file. A later edit asks again. Untrusted profiles aren't applied."
    />
    {#if file}
      <div class="grid divide-y divide-border rounded-lg border">
        <div class="flex flex-wrap items-center gap-2 px-3 py-2">
          <span class="text-sm font-medium text-foreground"
            >{file.label ?? file.name}</span
          >
          <Badge variant="info">Project file</Badge>
          <span class="text-xs text-muted-foreground"
            >Usable by {file.usableBy === "lead"
              ? "main agent"
              : file.usableBy === "subagent"
                ? "sub-agents"
                : "main agent and sub-agents"}</span
          >
        </div>
        {#each lines as line (line.label)}
          <div class="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 px-3 py-1.5">
            <span class="text-xs text-muted-foreground">{line.label}</span>
            <span
              class="max-h-40 overflow-auto text-sm break-words whitespace-pre-wrap text-foreground"
              >{line.value}</span
            >
          </div>
        {/each}
      </div>
    {/if}
    {#if error}<p class="text-xs text-destructive" role="alert">{error}</p>{/if}
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Not now</Button>
    <Button disabled={busy || !profile?.digest} onclick={onTrust}
      >Trust this version</Button
    >
  {/snippet}
</Dialog>

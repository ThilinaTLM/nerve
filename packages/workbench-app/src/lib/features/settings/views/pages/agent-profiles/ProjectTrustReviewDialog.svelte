<script lang="ts">
import type { ModelInfo } from "@nervekit/contracts/models";
import type { AgentProfilesConfiguration } from "@nervekit/contracts/agent-profiles";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { profileTrustReviewEntries } from "./agent-profile-rows";

/** Lists every project entry, flagging risky fields, before trusting this exact file version. */
let {
  open = $bindable(false),
  configuration,
  models,
  busy = false,
  onTrust,
}: {
  open?: boolean;
  configuration: AgentProfilesConfiguration;
  models: readonly ModelInfo[];
  busy?: boolean;
  onTrust: () => void;
} = $props();

const entries = $derived(
  profileTrustReviewEntries(
    configuration.document,
    configuration.profiles,
    models,
  ),
);
const description = $derived(
  `.nerve/config/agent-profiles.json · ${entries.length} ${entries.length === 1 ? "entry" : "entries"}. Trusting applies this exact version; later changes to the file ask again.`,
);

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
</script>

<DialogShell
  bind:open
  title="Review project agent profiles"
  {description}
  size="wide"
>
  <div class="grid gap-2">
    {#each entries as entry (entry.name)}
      <section class="grid gap-1.5 rounded-md border bg-card p-3">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-sm font-medium text-foreground">{entry.label}</span>
          <Badge variant="neutral">{entry.isNew ? "New" : "Changed"}</Badge>
          {#if entry.autonomous}
            <Badge variant="warning">Autonomous</Badge>
          {/if}
        </div>
        {#if entry.description}
          <p class="text-xs text-muted-foreground">{entry.description}</p>
        {/if}
        {#if entry.fields.length}
          <dl
            class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs"
          >
            {#each entry.fields as field (field.label)}
              <dt class="text-muted-foreground">{capitalize(field.label)}</dt>
              <dd
                class={(field.label === "permission" && entry.autonomous) ||
                (field.label === "tools" && field.value.includes("+"))
                  ? "text-warning"
                  : "text-foreground"}
              >
                {field.label === "permission" && entry.autonomous
                  ? "Autonomous: edits files and runs commands without asking"
                  : field.value}
              </dd>
            {/each}
          </dl>
        {/if}
        {#if entry.instructions}
          <div class="grid gap-0.5">
            <span class="text-xs text-warning">Instructions</span>
            <pre
              class="max-h-32 overflow-auto rounded-sm bg-well p-2 font-mono text-xs whitespace-pre-wrap break-words select-text">{entry.instructions}</pre>
          </div>
        {/if}
      </section>
    {:else}
      <p class="text-xs text-muted-foreground">
        The project file has no profile entries.
      </p>
    {/each}
  </div>
  {#snippet footer()}
    <Button variant="outline" onclick={() => (open = false)}>Not now</Button>
    <Button disabled={busy || !configuration.digest} onclick={onTrust}
      >Trust this version</Button
    >
  {/snippet}
</DialogShell>

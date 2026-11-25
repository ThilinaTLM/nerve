<!-- Where a server's entry lives, the user's decision on it, and removing it. -->
<script lang="ts">
import type { McpServerRow } from "@nervekit/contracts/mcp";
import { FieldRow } from "@nervekit/ui-kit/components/composites/page";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { SettingsSection, TrustStateBadge } from "$lib/presentation/settings";

let {
  row,
  path,
  busy = false,
  onOpenFile,
  onRevoke,
  onRemove,
}: {
  row: McpServerRow;
  /** The file that holds the entry, when known. */
  path?: string;
  busy?: boolean;
  onOpenFile?: () => void;
  /** Withdraws trust: the entry becomes Declined. */
  onRevoke?: () => void;
  onRemove: () => void;
} = $props();

const where = $derived(
  row.scope === "project" ? "This project" : "Your settings",
);
</script>

<SettingsSection id="source" title="Source" divided>
  <FieldRow label="Defined in" description={path}>
    {#snippet control()}
      <div class="flex items-center justify-end gap-2">
        <span class="text-ui text-muted-foreground">{where}</span>
        {#if onOpenFile}
          <Button size="sm" variant="outline" onclick={onOpenFile}
            >Open file</Button
          >
        {/if}
      </div>
    {/snippet}
  </FieldRow>
  {#if row.review === "trusted"}
    <FieldRow
      label="Trust"
      description="Covers this exact entry. A change made outside Nerve asks again."
    >
      {#snippet control()}
        <div class="flex items-center justify-end gap-2">
          <TrustStateBadge state="trusted" />
          {#if onRevoke}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onclick={onRevoke}>Revoke</Button
            >
          {/if}
        </div>
      {/snippet}
    </FieldRow>
  {/if}
  <FieldRow
    label="Remove server"
    description="Deletes the entry, its approval and its stored secrets."
  >
    {#snippet control()}
      <Button
        size="sm"
        variant="outline"
        class="text-destructive"
        disabled={busy}
        onclick={onRemove}>Remove</Button
      >
    {/snippet}
  </FieldRow>
</SettingsSection>

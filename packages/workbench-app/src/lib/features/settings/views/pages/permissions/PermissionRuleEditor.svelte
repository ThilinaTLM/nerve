<script lang="ts">
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";

type Props = {
  scope: "project" | "user";
  source: string;
  error?: string;
};

let { scope, source = $bindable(""), error }: Props = $props();
</script>

<div class="grid gap-2">
  <Label for={`permission-rule-json-${scope}`}>Rule JSON</Label>
  <Textarea
    id={`permission-rule-json-${scope}`}
    bind:value={source}
    rows={14}
    spellcheck={false}
    aria-invalid={Boolean(error)}
    class="max-h-[45vh] min-h-56 resize-y font-mono text-xs"
  />
  <p class="text-xs text-muted-foreground">
    {#if scope === "user"}
      User overlays may define overridable rules or prompt/deny guardrails.
    {:else}
      Project overlays may define overridable rules only.
    {/if}
  </p>
  {#if error}<p class="text-xs text-destructive">{error}</p>{/if}
</div>

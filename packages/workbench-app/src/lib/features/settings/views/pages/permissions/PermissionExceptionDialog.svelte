<script lang="ts">
import { permissionOverlayForOriginSchema } from "@nervekit/contracts/permissions";
import type { PermissionRule } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";

type Props = {
  open?: boolean;
  scope: "project" | "user";
  ruleSetId: string;
  rule?: PermissionRule;
  onSave?: (rule: PermissionRule) => Promise<boolean>;
};

let {
  open = $bindable(false),
  scope,
  ruleSetId,
  rule,
  onSave,
}: Props = $props();
let source = $state("");
let saving = $state(false);
let error = $state<string>();

$effect(() => {
  if (!open) return;
  source = JSON.stringify(rule ?? newRule(scope), null, 2);
  error = undefined;
});

async function save(): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (parseError) {
    error =
      parseError instanceof Error ? parseError.message : "Enter valid JSON.";
    return;
  }

  const parsed = permissionOverlayForOriginSchema(scope).safeParse({
    ruleSetId,
    rules: [value],
  });
  if (!parsed.success) {
    error = parsed.error.issues
      .map((issue) => {
        const path = issue.path.slice(1).join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join(" ");
    return;
  }

  const parsedRule = parsed.data.rules[0];
  if (!parsedRule || !onSave) return;
  saving = true;
  error = undefined;
  try {
    if (await onSave(parsedRule)) open = false;
    else
      error = "Could not save this rule. Review the permission settings error.";
  } finally {
    saving = false;
  }
}

function newRule(targetScope: "project" | "user"): PermissionRule {
  return {
    id: `rule-${crypto.randomUUID().replaceAll("-", "")}`,
    description: `Allow write at ${targetScope} scope`,
    enabled: true,
    priority: 0,
    enforcement: "overridable",
    when: { toolNames: ["write"] },
    decision: "allow",
  };
}
</script>

<Dialog
  bind:open
  size="wide"
  title={`${rule ? "Edit" : "Add"} ${scope} permission rule`}
  description={`This rule applies only to the ${ruleSetId} permission rule set and is validated before the overlay is saved atomically.`}
>
  <div class="grid gap-2">
    <Label for={`permission-rule-json-${scope}`}>Rule JSON</Label>
    <Textarea
      id={`permission-rule-json-${scope}`}
      bind:value={source}
      rows={18}
      spellcheck={false}
      aria-invalid={Boolean(error)}
      class="max-h-[55vh] min-h-72 resize-y font-mono text-xs"
    />
    <p class="text-xs text-muted-foreground">
      User overlays may define overridable rules or prompt/deny guardrails.
      Project overlays may define overridable rules only.
    </p>
    {#if error}<p class="text-xs text-destructive">{error}</p>{/if}
  </div>
  {#snippet footer()}
    <Button
      size="sm"
      variant="ghost"
      disabled={saving}
      onclick={() => (open = false)}>Cancel</Button
    >
    <Button size="sm" disabled={saving} onclick={() => void save()}>
      {#if saving}<Spinner class="size-3.5" />Saving…{:else}{rule
          ? "Save rule"
          : "Add rule"}{/if}
    </Button>
  {/snippet}
</Dialog>

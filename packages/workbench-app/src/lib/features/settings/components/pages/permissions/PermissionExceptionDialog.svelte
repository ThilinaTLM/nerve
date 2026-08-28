<script lang="ts">
import type { PermissionRule } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import SelectField from "@nervekit/ui-kit/components/ui/select-field";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";

type Props = {
  open?: boolean;
  scope: "project" | "user";
  onSave?: (rule: PermissionRule) => Promise<boolean>;
};

let { open = $bindable(false), scope, onSave }: Props = $props();
let toolName = $state("write");
let decision = $state<PermissionRule["decision"]>("allow");
let enforcement = $state<PermissionRule["enforcement"]>("overridable");
let saving = $state(false);
let error = $state<string>();

$effect(() => {
  if (!open) return;
  toolName = "write";
  decision = "allow";
  enforcement = "overridable";
  error = undefined;
});

$effect(() => {
  if (scope === "project") enforcement = "overridable";
  if (enforcement === "guardrail" && decision === "allow") decision = "deny";
});

async function save(): Promise<void> {
  const name = toolName.trim();
  if (!name || /\r|\n|\0/.test(name)) {
    error = "Enter one stable tool name.";
    return;
  }
  if (!onSave) return;
  saving = true;
  try {
    const rule: PermissionRule = {
      id: `rule-${crypto.randomUUID().replaceAll("-", "")}`,
      description: `${decision} ${name} at ${scope} scope`,
      enabled: true,
      priority: 0,
      enforcement,
      when: { toolNames: [name] },
      decision,
    };
    if (await onSave(rule)) open = false;
  } finally {
    saving = false;
  }
}
</script>

<Dialog
  bind:open
  size="sm"
  title={`Add ${scope} permission rule`}
  description="Create a focused whole-request rule for one tool. More advanced argument and target filters can be edited in permissions.json."
>
  <div class="grid gap-3">
    <div class="grid gap-1.5">
      <Label for={`permission-rule-tool-${scope}`}>Tool name</Label>
      <Input
        id={`permission-rule-tool-${scope}`}
        size="xs"
        bind:value={toolName}
        placeholder="write"
        ariaLabel="Permission rule tool name"
        class="font-mono"
      />
    </div>
    <div class="grid gap-1.5">
      <Label>Decision</Label>
      <SelectField
        items={[
          {
            value: "allow",
            label: "Allow",
            disabled: enforcement === "guardrail",
          },
          { value: "prompt", label: "Prompt" },
          { value: "deny", label: "Deny" },
        ]}
        value={decision}
        onValueChange={(value) => (decision = value as typeof decision)}
        ariaLabel="Permission decision"
      />
    </div>
    {#if scope === "user"}
      <div class="grid gap-1.5">
        <Label>Enforcement</Label>
        <SelectField
          items={[
            {
              value: "overridable",
              label: "User default",
              detail: "Project and conversation rules may replace it",
            },
            {
              value: "guardrail",
              label: "Guardrail",
              detail: "Project and conversation rules cannot replace it",
            },
          ]}
          value={enforcement}
          onValueChange={(value) => (enforcement = value as typeof enforcement)}
          ariaLabel="Permission enforcement"
        />
      </div>
    {/if}
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
      {#if saving}<Spinner class="size-3.5" />Saving…{:else}Add rule{/if}
    </Button>
  {/snippet}
</Dialog>

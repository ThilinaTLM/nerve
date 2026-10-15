<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import type { PermissionRule } from "@nervekit/contracts/permissions";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import {
  newRuleTemplate,
  validateRuleSource,
  type OverrideScope,
} from "./permission-rule-sets-view";

type Props = {
  open?: boolean;
  scope: OverrideScope;
  ruleSetId: string;
  ruleSetName: string;
  /** Scope label such as "User overrides" or "Project overrides · name". */
  scopeLabel: string;
  /** Rule being edited; omit to add a rule. */
  rule?: PermissionRule;
  /** All rules in this overlay, including the one being edited. */
  overlayRules: readonly PermissionRule[];
  /** Resolve with an error message to keep the dialog open, or nothing on success. */
  onSave: (rule: PermissionRule) => Promise<string | undefined>;
  onDelete?: () => Promise<string | undefined>;
};

let {
  open = $bindable(false),
  scope,
  ruleSetId,
  ruleSetName,
  scopeLabel,
  rule,
  overlayRules,
  onSave,
  onDelete,
}: Props = $props();

let source = $state("");
let serverError = $state<string>();
let busy = $state(false);
let lastOpen = false;

$effect(() => {
  if (open && !lastOpen) {
    source = rule
      ? JSON.stringify(rule, null, 2)
      : newRuleTemplate(overlayRules);
    serverError = undefined;
    busy = false;
  }
  lastOpen = open;
});

const siblings = $derived(overlayRules.filter((item) => item.id !== rule?.id));
const validation = $derived(
  validateRuleSource(source, scope, ruleSetId, siblings),
);

function format(): void {
  try {
    source = JSON.stringify(JSON.parse(source), null, 2);
  } catch {
    // Invalid input stays untouched; validation already explains the problem.
  }
}

async function run(action: () => Promise<string | undefined>): Promise<void> {
  busy = true;
  serverError = await action();
  busy = false;
  if (!serverError) open = false;
}

const errorText = $derived(validation.error ?? serverError);
</script>

<Dialog
  bind:open
  size="md"
  title={`${rule ? "Edit" : "Add"} ${scope} rule`}
  description={`${ruleSetName} · ${scopeLabel}`}
>
  <div class="grid gap-3">
    <div class="flex items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <Label for="permission-rule-json">Rule JSON</Label>
        <span
          class={validation.error
            ? "flex items-center gap-1 text-xs text-destructive"
            : "flex items-center gap-1 text-xs text-success"}
          aria-live="polite"
        >
          {#if validation.error}Needs attention{:else}<Check
              class="size-3.5"
              aria-hidden="true"
            /> Valid{/if}
        </span>
      </div>
      <Button variant="outline" size="sm" onclick={format}>Format JSON</Button>
    </div>
    <Textarea
      id="permission-rule-json"
      bind:value={source}
      rows={18}
      spellcheck={false}
      class="min-h-72 resize-y font-mono text-xs"
      aria-invalid={Boolean(errorText)}
      aria-describedby={errorText
        ? "permission-rule-guidance permission-rule-error"
        : "permission-rule-guidance"}
    />
    {#if errorText}
      <p
        id="permission-rule-error"
        role="alert"
        class="whitespace-pre-wrap rounded-md bg-destructive/10 p-3 text-xs text-destructive"
      >
        {errorText}
      </p>
    {/if}
    {#if validation.rule && Object.keys(validation.rule.when).length === 0}
      <p class="rounded-md bg-warning/10 p-3 text-xs text-warning">
        An empty “when” matches every request. Add conditions if this is not
        intentional.
      </p>
    {/if}
    <details class="text-xs text-muted-foreground">
      <summary
        id="permission-rule-guidance"
        class="cursor-pointer select-none hover:text-foreground"
        >Rule requirements</summary
      >
      <ul class="mt-2 grid list-disc gap-1.5 pl-4">
        {#if scope === "user"}
          <li>
            <span class="text-foreground">Enforcement:</span> overridable or guardrail.
            Guardrails can only prompt or deny.
          </li>
        {:else}
          <li>
            <span class="text-foreground">Enforcement:</span> overridable only. No
            allow rules targeting nerve_home or nerve_data roots.
          </li>
          <li>
            <span class="text-foreground">Trust:</span> project rules apply only while
            the permission file is trusted.
          </li>
        {/if}
        <li>
          <span class="text-foreground">ID:</span> unique within this overlay.
        </li>
        <li>
          <span class="text-foreground">Priority:</span> −1000 to 1000; unique within
          each enforcement class.
        </li>
      </ul>
    </details>
  </div>
  {#snippet footer()}
    {#if rule && onDelete}
      <Button
        variant="destructive"
        class="mr-auto"
        disabled={busy}
        onclick={() => run(onDelete)}>Delete rule</Button
      >
    {/if}
    <Button variant="outline" disabled={busy} onclick={() => (open = false)}
      >Cancel</Button
    >
    <Button
      disabled={busy || Boolean(validation.error)}
      onclick={() => {
        const parsed = validation.rule;
        if (parsed) void run(() => onSave(parsed));
      }}>{busy ? "Saving…" : rule ? "Save rule" : "Add rule"}</Button
    >
  {/snippet}
</Dialog>

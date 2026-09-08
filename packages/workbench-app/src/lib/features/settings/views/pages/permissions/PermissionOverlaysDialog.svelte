<script lang="ts">
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import Plus from "@lucide/svelte/icons/plus";
import ShieldAlert from "@lucide/svelte/icons/shield-alert";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import { permissionOverlayForOriginSchema } from "@nervekit/contracts/permissions";
import type { PermissionRule } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { SettingsGroup } from "$lib/presentation/settings";
import PermissionExceptionList from "./PermissionExceptionList.svelte";
import PermissionRuleEditor from "./PermissionRuleEditor.svelte";
import type { PermissionsPageState } from "./permissions-page-state.svelte";

type Scope = "project" | "user";

type Props = {
  open?: boolean;
  controller: PermissionsPageState;
  ruleSetId: string;
  ruleSetName: string;
  editable: boolean;
  hasProject: boolean;
};

let {
  open = $bindable(false),
  controller,
  ruleSetId,
  ruleSetName,
  editable,
  hasProject,
}: Props = $props();

let view = $state<"list" | "edit">("list");
let scope = $state<Scope>("user");
let editingRule = $state<PermissionRule>();
let source = $state("");
let error = $state<string>();
let saving = $state(false);

const trust = $derived(controller.configuration?.projectTrust);
const projectRules = $derived(controller.rules("project"));
const userRules = $derived(controller.rules("user"));

function pendingIds(target: Scope): string[] {
  return (target === "project" ? projectRules : userRules)
    .filter((rule) => controller.isPending(target, rule.id))
    .map((rule) => rule.id);
}

$effect(() => {
  if (open) return;
  view = "list";
  editingRule = undefined;
  error = undefined;
});

function newRule(targetScope: Scope): PermissionRule {
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

function openEditor(target: Scope, rule?: PermissionRule): void {
  scope = target;
  editingRule = rule;
  source = JSON.stringify(rule ?? newRule(target), null, 2);
  error = undefined;
  view = "edit";
}

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
  if (!parsedRule) return;
  saving = true;
  error = undefined;
  try {
    const saved = editingRule
      ? await controller.update(scope, editingRule.id, parsedRule)
      : await controller.add(scope, parsedRule);
    if (saved) view = "list";
    else error = "Could not save this rule. Review the permission error above.";
  } finally {
    saving = false;
  }
}
</script>

<Dialog
  bind:open
  size={view === "edit" ? "wide" : "md"}
  title={view === "edit"
    ? `${editingRule ? "Edit" : "Add"} ${scope} rule`
    : `${ruleSetName} overrides`}
  description={view === "edit"
    ? `Validated against the ${ruleSetId} rule set before the overlay is saved atomically.`
    : `Project and user rules layered on top of the ${ruleSetName} rule set.`}
>
  {#if view === "edit"}
    <PermissionRuleEditor {scope} bind:source {error} />
  {:else}
    <div class="grid gap-4">
      <SettingsGroup
        title="Project"
        info="Repository-controlled rules for the active project. Project rules override user defaults but never user guardrails."
      >
        {#if trust}
          <div
            class="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2"
          >
            <div class="flex min-w-0 items-center gap-2">
              {#if trust.status === "trusted"}
                <ShieldCheck class="size-4 shrink-0 text-success" />
              {:else}
                <ShieldAlert class="size-4 shrink-0 text-warning" />
              {/if}
              <div class="min-w-0">
                <p class="text-sm capitalize">{trust.status}</p>
                <p class="truncate text-xs text-muted-foreground">
                  {trust.reason ??
                    trust.digest ??
                    "No project overlay has been discovered."}
                </p>
              </div>
            </div>
            {#if trust.status === "untrusted"}
              <Button
                size="sm"
                variant="outline"
                disabled={controller.isPending("project", "trust")}
                onclick={() => void controller.setTrusted(true)}
                >Trust digest</Button
              >
            {:else if trust.status === "trusted"}
              <Button
                size="sm"
                variant="outline"
                disabled={controller.isPending("project", "trust")}
                onclick={() => void controller.setTrusted(false)}
                >Revoke trust</Button
              >
            {/if}
          </div>
        {/if}
        <PermissionExceptionList
          rules={projectRules}
          pendingIds={pendingIds("project")}
          emptyTitle={hasProject ? "No project rules" : "No project selected"}
          onEdit={editable ? (rule) => openEditor("project", rule) : undefined}
          onRemove={(id) => void controller.remove("project", id)}
        />
        <div class="flex justify-end">
          <Button
            size="xs"
            variant="outline"
            disabled={!editable || !hasProject}
            onclick={() => openEditor("project")}
            ><Plus class="size-3.5" />Add project rule</Button
          >
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="User"
        info="Stored in your Nerve home and applied across projects. A guardrail may prompt or deny and cannot be replaced by project rules."
      >
        <PermissionExceptionList
          rules={userRules}
          pendingIds={pendingIds("user")}
          emptyTitle="No user rules"
          onEdit={editable ? (rule) => openEditor("user", rule) : undefined}
          onRemove={(id) => void controller.remove("user", id)}
        />
        <div class="flex justify-end">
          <Button
            size="xs"
            variant="outline"
            disabled={!editable}
            onclick={() => openEditor("user")}
            ><Plus class="size-3.5" />Add user rule</Button
          >
        </div>
      </SettingsGroup>
    </div>
  {/if}

  {#snippet footer()}
    {#if view === "edit"}
      <Button
        size="sm"
        variant="ghost"
        disabled={saving}
        onclick={() => (view = "list")}
        ><ArrowLeft class="size-3.5" />Back</Button
      >
      <Button size="sm" disabled={saving} onclick={() => void save()}>
        {#if saving}<Spinner class="size-3.5" />Saving…{:else}{editingRule
            ? "Save rule"
            : "Add rule"}{/if}
      </Button>
    {:else}
      <Button size="sm" variant="outline" onclick={() => (open = false)}
        >Done</Button
      >
    {/if}
  {/snippet}
</Dialog>

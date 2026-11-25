<!--
  One rule set's detail view, below its page header: badges and role note, the
  rule set's own rules (read-only), then the user and project overrides with
  their Add rule, edit and trust controls.
-->
<script lang="ts">
import {
  PageItem,
  PageList,
} from "@nervekit/ui-kit/components/composites/page";
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import type {
  PermissionPolicyConfiguration,
  PermissionRule,
  PermissionRuleSetWithRules,
} from "@nervekit/contracts/permissions";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import {
  SettingsSection,
  TrustDecisionActions,
  TrustStateBadge,
} from "$lib/presentation/settings";
import PermissionRuleSetBadges from "./PermissionRuleSetBadges.svelte";
import {
  overridesFor,
  ruleSummary,
  ruleTitle,
  type OverrideScope,
} from "./permission-rule-sets-view";

type Props = {
  ruleSet: PermissionRuleSetWithRules;
  configuration: PermissionPolicyConfiguration;
  isDefault: boolean;
  /** Present when a project is active; enables the project overrides group. */
  projectName?: string;
  onEdit: (scope: OverrideScope, rule?: PermissionRule) => void;
  onTrustProject?: () => void;
  /** Declines the project's file (also revokes a trusted one). */
  onDeclineProject?: () => void;
  trusting?: boolean;
};

let {
  ruleSet,
  configuration,
  isDefault,
  projectName,
  onEdit,
  onTrustProject,
  onDeclineProject,
  trusting = false,
}: Props = $props();

const trust = $derived(configuration.projectTrust);
const scopes = $derived<OverrideScope[]>(
  projectName ? ["user", "project"] : ["user"],
);
const rules = $derived(ruleSet.rules);
const roleNote = $derived(
  ruleSet.id === "baseline"
    ? "Always applied underneath the selected rule set."
    : "Selectable for conversations and agent profiles.",
);
</script>

<div class="flex flex-wrap items-center gap-2 text-ui text-muted-foreground">
  <Badge variant="neutral"
    >{ruleSet.source === "builtin" ? "Built-in" : "User"}</Badge
  >
  <PermissionRuleSetBadges {ruleSet} {isDefault} />
  <span>{roleNote}</span>
</div>

{#if rules.length > 0}
  <SettingsSection
    id="rules"
    title="Rules"
    description="Its own rules, read-only. Overrides below take precedence by priority."
  >
    <PageList ariaLabel={`Rules in ${ruleSet.name}`}>
      {#each rules as rule (rule.id)}
        <PageItem title={ruleTitle(rule)} summary={ruleSummary(rule)}>
          {#snippet badges()}
            {#if rule.enforcement === "guardrail"}<Badge variant="neutral"
                >Guardrail</Badge
              >{/if}
            {#if !rule.enabled}<Badge variant="neutral">Disabled</Badge>{/if}
          {/snippet}
        </PageItem>
      {/each}
    </PageList>
  </SettingsSection>
{/if}

{#each scopes as scope (scope)}
  {@const overrides = overridesFor(configuration, scope, ruleSet.id)}
  {@const locked =
    scope === "project" &&
    (trust.status === "needs_review" ||
      trust.status === "declined" ||
      trust.status === "invalid")}
  <SettingsSection
    id={`${scope}-overrides`}
    title={scope === "user" ? "User overrides" : "Project overrides"}
  >
    {#snippet actions()}
      {#if scope === "project" && trust.status === "invalid"}
        <Badge variant="destructive">Invalid file</Badge>
      {:else if scope === "project" && (trust.status === "needs_review" || trust.status === "trusted" || trust.status === "declined")}
        <TrustStateBadge state={trust.status} />
      {/if}
      <Button
        variant="outline"
        size="sm"
        disabled={locked}
        onclick={() => onEdit(scope)}
      >
        <Plus data-icon="inline-start" aria-hidden="true" /> Add rule
      </Button>
    {/snippet}
    {#if scope === "project" && (trust.status === "needs_review" || trust.status === "declined")}
      <div
        class={[
          "flex flex-wrap items-center justify-between gap-2 text-ui",
          trust.status === "needs_review"
            ? "text-warning"
            : "text-muted-foreground",
        ]}
      >
        <p>
          {trust.status === "declined"
            ? "You declined the project's file, so these rules don't apply."
            : `${trust.reason ?? "The file has not been trusted."} Review the rules, then trust the file to apply them and enable editing.`}
        </p>
        <div class="flex flex-wrap gap-2">
          <TrustDecisionActions
            state={trust.status}
            busy={trusting}
            onTrust={onTrustProject}
            onDecline={onDeclineProject}
          />
        </div>
      </div>
    {/if}
    {#if overrides.length > 0}
      <PageList ariaLabel={`${scope} overrides for ${ruleSet.name}`}>
        {#each overrides as rule (rule.id)}
          <PageItem title={ruleTitle(rule)} summary={ruleSummary(rule)}>
            {#snippet badges()}
              {#if rule.enforcement === "guardrail"}<Badge variant="neutral"
                  >Guardrail</Badge
                >{/if}
              {#if !rule.enabled}<Badge variant="neutral">Disabled</Badge>{/if}
            {/snippet}
            {#snippet actions()}
              <IconAction
                icon={Pencil}
                label={`Edit rule ${rule.id}`}
                disabled={scope === "project" &&
                  (trust.status === "needs_review" ||
                    trust.status === "declined")}
                onclick={() => onEdit(scope, rule)}
              />
            {/snippet}
          </PageItem>
        {/each}
      </PageList>
    {:else}
      <p class="text-ui text-muted-foreground">
        No {scope} overrides. This rule set applies without changes here.
      </p>
    {/if}
  </SettingsSection>
{/each}

<!--
  One rule set's detail view, below its page header: badges and role note, the
  rule set's own rules (read-only), then the user and project overrides with
  their Add rule, edit and trust controls.
-->
<script lang="ts">
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
  SettingsItem,
  SettingsList,
  SettingsSection,
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
  trusting?: boolean;
};

let {
  ruleSet,
  configuration,
  isDefault,
  projectName,
  onEdit,
  onTrustProject,
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

function trustLabel(): string {
  return trust.status === "trusted"
    ? "Trusted"
    : trust.status === "invalid"
      ? "Invalid file"
      : "Not applied · untrusted";
}
</script>

<div class="flex flex-wrap items-center gap-2 text-ui text-muted-foreground">
  <PermissionRuleSetBadges {ruleSet} {isDefault} />
  <span>{roleNote}</span>
</div>

{#if rules.length > 0}
  <SettingsSection
    id="rules"
    title="Rules"
    description="Its own rules, read-only. Overrides below take precedence by priority."
  >
    <SettingsList ariaLabel={`Rules in ${ruleSet.name}`}>
      {#each rules as rule (rule.id)}
        <SettingsItem title={ruleTitle(rule)} summary={ruleSummary(rule)}>
          {#snippet badges()}
            {#if rule.enforcement === "guardrail"}<Badge variant="neutral"
                >Guardrail</Badge
              >{/if}
            {#if !rule.enabled}<Badge variant="neutral">Disabled</Badge>{/if}
          {/snippet}
        </SettingsItem>
      {/each}
    </SettingsList>
  </SettingsSection>
{/if}

{#each scopes as scope (scope)}
  {@const overrides = overridesFor(configuration, scope, ruleSet.id)}
  {@const locked =
    scope === "project" &&
    (trust.status === "untrusted" || trust.status === "invalid")}
  <SettingsSection
    id={`${scope}-overrides`}
    title={scope === "user"
      ? "User overrides"
      : `Project overrides · ${projectName}`}
  >
    {#snippet actions()}
      {#if scope === "project" && trust.status !== "missing"}
        <Badge
          variant={trust.status === "trusted"
            ? "success"
            : trust.status === "invalid"
              ? "destructive"
              : "warning"}>{trustLabel()}</Badge
        >
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
    {#if scope === "project" && trust.status === "untrusted"}
      <div
        class="flex flex-wrap items-center justify-between gap-2 text-ui text-warning"
      >
        <p>
          {trust.reason ?? "The file has not been trusted."} Review the rules, then
          trust the file to apply them and enable editing.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={trusting}
          onclick={() => onTrustProject?.()}
          >{trusting ? "Trusting…" : "Trust project file"}</Button
        >
      </div>
    {/if}
    {#if overrides.length > 0}
      <SettingsList ariaLabel={`${scope} overrides for ${ruleSet.name}`}>
        {#each overrides as rule (rule.id)}
          <SettingsItem title={ruleTitle(rule)} summary={ruleSummary(rule)}>
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
                disabled={scope === "project" && trust.status === "untrusted"}
                onclick={() => onEdit(scope, rule)}
              />
            {/snippet}
          </SettingsItem>
        {/each}
      </SettingsList>
    {:else}
      <p class="text-ui text-muted-foreground">
        No {scope} overrides. This rule set applies without changes here.
      </p>
    {/if}
  </SettingsSection>
{/each}

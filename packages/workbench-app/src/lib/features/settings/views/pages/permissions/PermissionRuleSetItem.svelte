<script lang="ts">
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import type {
  PermissionPolicyConfiguration,
  PermissionRule,
  PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { SettingsItem, SettingsList } from "$lib/presentation/settings";
import {
  overlaySummary,
  overridesFor,
  ruleMetadata,
  ruleTitle,
  type OverrideScope,
} from "./permission-rule-sets-view";

type Props = {
  ruleSet: PermissionRuleSetSummary;
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

let open = $state(false);
const summary = $derived(overlaySummary(configuration, ruleSet.id));
const trust = $derived(configuration.projectTrust);
const scopes = $derived<OverrideScope[]>(
  projectName ? ["user", "project"] : ["user"],
);

const roleNote = $derived(
  ruleSet.id === "baseline"
    ? "Always applied underneath the selected rule set."
    : "Selectable for conversations and agent profiles.",
);
</script>

<SettingsItem
  title={ruleSet.name}
  summary={open ? undefined : summary.label}
  expanded={open}
  onOpen={() => (open = !open)}
  openLabel={`${open ? "Collapse" : "Expand"} ${ruleSet.name}`}
>
  {#snippet badges()}
    <Badge variant="neutral"
      >{ruleSet.source === "builtin" ? "Built-in" : "User-defined"}</Badge
    >
    {#if isDefault}<Badge variant="brand">Default</Badge>{/if}
    {#if !ruleSet.enabled}<Badge variant="neutral">Disabled</Badge>{/if}
  {/snippet}
  {#if open}
    <div class="grid gap-4 pt-1 text-ui text-muted-foreground">
      <div class="grid gap-0.5">
        <p>{summary.label}</p>
        {#if ruleSet.description}
          <p class="text-ui text-foreground">{ruleSet.description}</p>
        {/if}
        <p>{roleNote}</p>
      </div>
      {#each scopes as scope (scope)}
        {@const rules = overridesFor(configuration, scope, ruleSet.id)}
        <div class="grid gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <h4 class="text-ui font-medium text-muted-foreground">
                {scope === "user"
                  ? "User overrides"
                  : `Project overrides · ${projectName}`}
              </h4>
              {#if scope === "project" && trust.status !== "missing"}
                <Badge
                  variant={trust.status === "trusted"
                    ? "success"
                    : trust.status === "invalid"
                      ? "destructive"
                      : "warning"}
                  >{trust.status === "trusted"
                    ? "Trusted"
                    : trust.status === "invalid"
                      ? "Invalid file"
                      : "Not applied · untrusted"}</Badge
                >
              {/if}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={scope === "project" &&
                (trust.status === "untrusted" || trust.status === "invalid")}
              onclick={() => onEdit(scope)}
            >
              <Plus data-icon="inline-start" aria-hidden="true" /> Add rule
            </Button>
          </div>
          {#if scope === "project" && trust.status === "untrusted"}
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-warning">
                {trust.reason ?? "The file has not been trusted."} Review the rules,
                then trust the file to apply them and enable editing.
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
          {#if rules.length > 0}
            <SettingsList ariaLabel={`${scope} overrides for ${ruleSet.name}`}>
              {#each rules as rule (rule.id)}
                <SettingsItem
                  title={ruleTitle(rule)}
                  summary={[
                    `priority ${rule.priority}`,
                    ...ruleMetadata(rule),
                  ].join(" · ")}
                >
                  {#snippet badges()}
                    {#if rule.enforcement === "guardrail"}<Badge
                        variant="neutral">Guardrail</Badge
                      >{/if}
                    {#if !rule.enabled}<Badge variant="neutral">Disabled</Badge
                      >{/if}
                  {/snippet}
                  {#snippet actions()}
                    <IconAction
                      icon={Pencil}
                      label={`Edit rule ${rule.id}`}
                      disabled={scope === "project" &&
                        trust.status === "untrusted"}
                      onclick={() => onEdit(scope, rule)}
                    />
                  {/snippet}
                </SettingsItem>
              {/each}
            </SettingsList>
          {:else}
            <p>
              No {scope} overrides. This rule set applies without changes here.
            </p>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</SettingsItem>
